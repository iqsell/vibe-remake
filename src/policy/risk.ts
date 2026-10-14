export enum RiskLevel {
  NONE = 'NONE',
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface RiskAssessment {
  level: RiskLevel;
  factors: RiskFactor[];
  score: number; // 0-100
  requiresConfirmation: boolean;
  requiresApproval: boolean;
  maxScope: 'SINGLE' | 'FEW' | 'MANY' | 'ALL';
}

export interface RiskFactor {
  type: 'PERMISSION' | 'SCOPE' | 'IRREVERSIBLE' | 'VISIBILITY' | 'TARGET' | 'HISTORY';
  weight: number;
  description: string;
}

const TOOL_RISK_BASE: Record<string, RiskLevel> = {
  // Read-only tools - NONE
  getGuildInfo: RiskLevel.NONE,
  getMemberInfo: RiskLevel.NONE,
  getChannelInfo: RiskLevel.NONE,
  getRoleInfo: RiskLevel.NONE,
  searchMembers: RiskLevel.NONE,
  getAuditLog: RiskLevel.LOW,
  getBotPermissions: RiskLevel.NONE,
  comparePermissions: RiskLevel.NONE,
  getCaseHistory: RiskLevel.LOW,
  getTicket: RiskLevel.LOW,
  listTickets: RiskLevel.LOW,
  getApplication: RiskLevel.LOW,
  listApplications: RiskLevel.LOW,
  getApplicationPanel: RiskLevel.LOW,
  listApplicationPanels: RiskLevel.LOW,
  getStaffDuty: RiskLevel.LOW,
  getStaffActivity: RiskLevel.LOW,
  checkPermissions: RiskLevel.NONE,
  getRoleHierarchy: RiskLevel.NONE,
  getReports: RiskLevel.LOW,

  // Low risk - reversible, limited scope
  removeTimeout: RiskLevel.LOW,
  setNickname: RiskLevel.LOW,
  setSlowmode: RiskLevel.LOW,
  lockChannel: RiskLevel.LOW,
  unlockChannel: RiskLevel.LOW,
  createModerationCase: RiskLevel.LOW,
  addCaseEvidence: RiskLevel.LOW,
  createTicket: RiskLevel.LOW,
  claimTicket: RiskLevel.LOW,
  transferTicket: RiskLevel.LOW,
  addTicketParticipant: RiskLevel.LOW,
  removeTicketParticipant: RiskLevel.LOW,
  addTicketNote: RiskLevel.LOW,
  generateTranscript: RiskLevel.LOW,
  submitApplication: RiskLevel.LOW,
  reviewApplication: RiskLevel.LOW,
  setStaffDuty: RiskLevel.LOW,
  createReport: RiskLevel.LOW,
  scheduleReminder: RiskLevel.LOW,
  createChannel: RiskLevel.LOW,
  editChannel: RiskLevel.LOW,
  moveChannel: RiskLevel.LOW,
  createCategory: RiskLevel.LOW,
  editCategory: RiskLevel.LOW,
  proposeServerLayout: RiskLevel.LOW,
  detectDuplicateChannels: RiskLevel.LOW,

  // Medium risk - affects users, semi-reversible
  timeoutMember: RiskLevel.MEDIUM,
  addRole: RiskLevel.MEDIUM,
  removeRole: RiskLevel.MEDIUM,
  deleteMessages: RiskLevel.MEDIUM,
  appealCase: RiskLevel.MEDIUM,
  resolveAppeal: RiskLevel.MEDIUM,
  closeTicket: RiskLevel.MEDIUM,
  reopenTicket: RiskLevel.MEDIUM,
  decideApplication: RiskLevel.MEDIUM,
  deleteChannel: RiskLevel.MEDIUM,
  deleteCategory: RiskLevel.MEDIUM,
  applyServerLayout: RiskLevel.MEDIUM,

  // High risk - significant impact, harder to reverse
  kickMember: RiskLevel.HIGH,
  purgeMessages: RiskLevel.HIGH,
  createApplicationPanel: RiskLevel.HIGH,

  // Critical risk - permanent, severe impact
  banMember: RiskLevel.CRITICAL,
  unbanMember: RiskLevel.HIGH, // Unban is high but not critical
};

export function assessToolRisk(toolName: string, args: Record<string, any>): RiskAssessment {
  const baseRisk = TOOL_RISK_BASE[toolName] ?? RiskLevel.MEDIUM;
  const factors: RiskFactor[] = [];
  let score = riskLevelToScore(baseRisk);

  // Scope factor
  const scopeFactor = assessScopeRisk(toolName, args);
  factors.push(scopeFactor);
  score += scopeFactor.weight;

  // Irreversibility factor
  const irreversibleFactor = assessIrreversibilityRisk(toolName);
  factors.push(irreversibleFactor);
  score += irreversibleFactor.weight;

  // Visibility factor
  const visibilityFactor = assessVisibilityRisk(toolName);
  factors.push(visibilityFactor);
  score += visibilityFactor.weight;

  // Target factor
  const targetFactor = assessTargetRisk(toolName, args);
  factors.push(targetFactor);
  score += targetFactor.weight;

  // History factor (would check past actions)
  const historyFactor = { type: 'HISTORY' as const, weight: 0, description: 'No history check implemented' };
  factors.push(historyFactor);

  const finalLevel = scoreToRiskLevel(score);
  const requiresConfirmation = finalLevel >= RiskLevel.MEDIUM;
  const requiresApproval = finalLevel >= RiskLevel.HIGH;
  const maxScope = getMaxScope(finalLevel);

  return {
    level: finalLevel,
    factors,
    score: Math.min(100, Math.max(0, score)),
    requiresConfirmation,
    requiresApproval,
    maxScope,
  };
}

function riskLevelToScore(level: RiskLevel): number {
  switch (level) {
    case RiskLevel.NONE: return 0;
    case RiskLevel.LOW: return 10;
    case RiskLevel.MEDIUM: return 30;
    case RiskLevel.HIGH: return 60;
    case RiskLevel.CRITICAL: return 90;
  }
}

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return RiskLevel.CRITICAL;
  if (score >= 50) return RiskLevel.HIGH;
  if (score >= 25) return RiskLevel.MEDIUM;
  if (score >= 5) return RiskLevel.LOW;
  return RiskLevel.NONE;
}

function assessScopeRisk(toolName: string, args: Record<string, any>): RiskFactor {
  // Check if bulk operation
  const bulkIndicators = ['limit', 'count', 'all', 'bulk', 'purge'];
  const isBulk = bulkIndicators.some(k => k in args) || toolName.includes('purge');
  
  if (isBulk) {
    return { type: 'SCOPE', weight: 20, description: 'Bulk operation affecting multiple targets' };
  }
  
  return { type: 'SCOPE', weight: 0, description: 'Single target operation' };
}

function assessIrreversibilityRisk(toolName: string): RiskFactor {
  const irreversibleTools = ['banMember', 'kickMember', 'deleteChannel', 'deleteCategory', 'deleteMessages', 'purgeMessages'];
  
  if (irreversibleTools.includes(toolName)) {
    return { type: 'IRREVERSIBLE', weight: 25, description: 'Action is difficult or impossible to reverse' };
  }
  
  const semiReversible = ['timeoutMember', 'removeRole', 'setNickname'];
  if (semiReversible.includes(toolName)) {
    return { type: 'IRREVERSIBLE', weight: 10, description: 'Action is reversible but may lose context' };
  }
  
  return { type: 'IRREVERSIBLE', weight: 0, description: 'Action is easily reversible' };
}

function assessVisibilityRisk(toolName: string): RiskFactor {
  const highVisibility = ['banMember', 'kickMember', 'createChannel', 'deleteChannel', 'applyServerLayout'];
  
  if (highVisibility.includes(toolName)) {
    return { type: 'VISIBILITY', weight: 15, description: 'Action is highly visible to server members' };
  }
  
  return { type: 'VISIBILITY', weight: 0, description: 'Action has low visibility' };
}

function assessTargetRisk(toolName: string, args: Record<string, any>): RiskFactor {
  // Check if targeting high-value targets (owner, admins, etc.)
  // This would need actual role/permission checks
  
  if (args.userId) {
    return { type: 'TARGET', weight: 5, description: 'Targets a specific user' };
  }
  
  if (args.roleId) {
    return { type: 'TARGET', weight: 10, description: 'Targets a role (affects multiple users)' };
  }
  
  if (args.channelId && toolName.includes('delete')) {
    return { type: 'TARGET', weight: 15, description: 'Deletes a channel (potential data loss)' };
  }
  
  return { type: 'TARGET', weight: 0, description: 'No specific target risk' };
}

function getMaxScope(level: RiskLevel): 'SINGLE' | 'FEW' | 'MANY' | 'ALL' {
  switch (level) {
    case RiskLevel.CRITICAL: return 'SINGLE';
    case RiskLevel.HIGH: return 'FEW';
    case RiskLevel.MEDIUM: return 'MANY';
    default: return 'ALL';
  }
}

export function combineRisks(assessments: RiskAssessment[]): RiskAssessment {
  if (assessments.length === 0) {
    return {
      level: RiskLevel.NONE,
      factors: [],
      score: 0,
      requiresConfirmation: false,
      requiresApproval: false,
      maxScope: 'ALL',
    };
  }

  const maxLevel = assessments.reduce((max, a) => 
    riskLevelToScore(a.level) > riskLevelToScore(max.level) ? a : max
  );

  const allFactors = assessments.flatMap(a => a.factors);
  const totalScore = assessments.reduce((sum, a) => sum + a.score, 0) / assessments.length;

  return {
    level: maxLevel.level,
    factors: allFactors,
    score: Math.round(totalScore),
    requiresConfirmation: assessments.some(a => a.requiresConfirmation),
    requiresApproval: assessments.some(a => a.requiresApproval),
    maxScope: maxLevel.maxScope,
  };
}