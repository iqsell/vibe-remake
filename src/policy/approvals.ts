import { prisma } from '../db/client.js';
import { logger, createGuildLogger } from '../observability/logger.js';
import { RiskLevel } from './risk.js';

export interface ApprovalRequest {
  id: string;
  guildId: string;
  userId: string;
  planId: string;
  planHash: string;
  toolName: string;
  toolArgs: Record<string, any>;
  riskLevel: RiskLevel;
  description: string;
  expiresAt: Date;
  createdAt: Date;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  approvedBy?: string;
  approvedAt?: Date;
  deniedBy?: string;
  deniedAt?: Date;
  denialReason?: string;
}

export interface ApprovalResult {
  approved: boolean;
  approvalId?: string;
  reason?: string;
  expiresAt?: Date;
}

export class ApprovalManager {
  private pendingApprovals = new Map<string, ApprovalRequest>();

  async requestApproval(request: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>): Promise<ApprovalResult> {
    const guildLogger = createGuildLogger(request.guildId);

    const approvalId = `approval_${request.guildId}_${request.userId}_${Date.now()}`;
    const fullRequest: ApprovalRequest = {
      ...request,
      id: approvalId,
      createdAt: new Date(),
      status: 'PENDING',
    };

    // Store in memory and database
    this.pendingApprovals.set(approvalId, fullRequest);
    
    await prisma.approval.create({
      data: {
        id: approvalId,
        guildId: request.guildId,
        userId: request.userId,
        planId: request.planId,
        planHash: request.planHash,
        toolName: request.toolName,
        toolArgs: request.toolArgs,
        riskLevel: request.riskLevel,
        description: request.description,
        expiresAt: request.expiresAt,
        status: 'PENDING',
      },
    }).catch(() => {
      // Table might not exist yet
    });

    guildLogger.info({ 
      target: 'policy.approval', 
      approvalId,
      toolName: request.toolName,
      riskLevel: request.riskLevel,
    }, 'Approval requested');

    return {
      approved: false,
      approvalId,
      reason: 'Pending approval',
      expiresAt: request.expiresAt,
    };
  }

  async checkApproval(approvalId: string): Promise<ApprovalResult> {
    let request = this.pendingApprovals.get(approvalId);
    
    if (!request) {
      // Try database
      const dbRecord = await prisma.approval.findUnique({ where: { id: approvalId } });
      if (dbRecord) {
        request = this.mapDbToRequest(dbRecord);
        this.pendingApprovals.set(approvalId, request);
      }
    }

    if (!request) {
      return { approved: false, reason: 'Approval not found' };
    }

    if (request.expiresAt < new Date()) {
      await this.expireApproval(approvalId);
      return { approved: false, reason: 'Approval expired' };
    }

    if (request.status === 'APPROVED') {
      return { approved: true, approvalId: request.id };
    }

    if (request.status === 'DENIED') {
      return { approved: false, reason: request.denialReason ?? 'Denied' };
    }

    return { approved: false, reason: 'Pending', expiresAt: request.expiresAt };
  }

  async approve(approvalId: string, approverId: string): Promise<ApprovalResult> {
    const request = this.pendingApprovals.get(approvalId);
    
    if (!request) {
      return { approved: false, reason: 'Approval not found' };
    }

    if (request.status !== 'PENDING') {
      return { approved: false, reason: `Already ${request.status.toLowerCase()}` };
    }

    if (request.expiresAt < new Date()) {
      await this.expireApproval(approvalId);
      return { approved: false, reason: 'Approval expired' };
    }

    if (request.userId === approverId) {
      return { approved: false, reason: 'Cannot approve own request' };
    }

    request.status = 'APPROVED';
    request.approvedBy = approverId;
    request.approvedAt = new Date();
    this.pendingApprovals.set(approvalId, request);

    await prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'APPROVED', approvedBy: approverId, approvedAt: new Date() },
    }).catch(() => {});

    logger.info({ target: 'policy.approval', approvalId, approverId }, 'Approval granted');

    return { approved: true, approvalId };
  }

  async deny(approvalId: string, denierId: string, reason: string): Promise<ApprovalResult> {
    const request = this.pendingApprovals.get(approvalId);
    
    if (!request) {
      return { approved: false, reason: 'Approval not found' };
    }

    if (request.status !== 'PENDING') {
      return { approved: false, reason: `Already ${request.status.toLowerCase()}` };
    }

    request.status = 'DENIED';
    request.deniedBy = denierId;
    request.deniedAt = new Date();
    request.denialReason = reason;
    this.pendingApprovals.set(approvalId, request);

    await prisma.approval.update({
      where: { id: approvalId },
      data: { status: 'DENIED', deniedBy: denierId, deniedAt: new Date(), denialReason: reason },
    }).catch(() => {});

    logger.info({ target: 'policy.approval', approvalId, denierId, reason }, 'Approval denied');

    return { approved: false, reason };
  }

  private async expireApproval(approvalId: string): Promise<void> {
    const request = this.pendingApprovals.get(approvalId);
    if (request) {
      request.status = 'EXPIRED';
      this.pendingApprovals.set(approvalId, request);

      await prisma.approval.update({
        where: { id: approvalId },
        data: { status: 'EXPIRED' },
      }).catch(() => {});
    }
  }

  async getPendingApprovals(guildId: string, userId?: string): Promise<ApprovalRequest[]> {
    const approvals: ApprovalRequest[] = [];
    
    for (const request of this.pendingApprovals.values()) {
      if (request.guildId === guildId && 
          (!userId || request.userId === userId) &&
          request.status === 'PENDING' &&
          request.expiresAt > new Date()) {
        approvals.push(request);
      }
    }

    return approvals.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  cleanupExpired(): void {
    const now = new Date();
    for (const [id, request] of this.pendingApprovals.entries()) {
      if (request.expiresAt < now && request.status === 'PENDING') {
        request.status = 'EXPIRED';
        this.pendingApprovals.set(id, request);
      }
    }
  }

  private mapDbToRequest(db: any): ApprovalRequest {
    return {
      id: db.id,
      guildId: db.guildId,
      userId: db.userId,
      planId: db.planId,
      planHash: db.planHash,
      toolName: db.toolName,
      toolArgs: db.toolArgs,
      riskLevel: db.riskLevel,
      description: db.description,
      expiresAt: new Date(db.expiresAt),
      createdAt: new Date(db.createdAt),
      status: db.status,
      approvedBy: db.approvedBy,
      approvedAt: db.approvedAt ? new Date(db.approvedAt) : undefined,
      deniedBy: db.deniedBy,
      deniedAt: db.deniedAt ? new Date(db.deniedAt) : undefined,
      denialReason: db.denialReason,
    };
  }
}

export const approvalManager = new ApprovalManager();

// Helper to create approval request from plan step
export function createApprovalRequestFromStep(
  guildId: string,
  userId: string,
  planId: string,
  planHash: string,
  step: { toolName: string; toolArgs: Record<string, any>; riskLevel: RiskLevel; description: string }
): Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'> {
  return {
    guildId,
    userId,
    planId,
    planHash,
    toolName: step.toolName,
    toolArgs: step.toolArgs,
    riskLevel: step.riskLevel,
    description: step.description,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
  };
}