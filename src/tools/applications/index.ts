import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import { fetchGuild, fetchTextChannel } from '../helpers.js';
import {
  createApplicationPanelSchema,
  submitApplicationSchema,
  reviewApplicationSchema,
  decideApplicationSchema,
  getApplicationSchema,
  listApplicationsSchema,
  getApplicationPanelSchema,
  listApplicationPanelsSchema,
} from '../schemas/applications.js';

function registration(
  name: string,
  description: string,
  schema: { input: any; output: any },
  riskLevel: ToolRegistration['riskLevel'],
  handler: ToolRegistration['handler'],
  opts: Partial<ToolRegistration> = {}
): ToolRegistration {
  return {
    name,
    version: '1.0.0',
    description,
    inputSchema: schema.input,
    outputSchema: schema.output,
    readOnly: false,
    riskLevel,
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: riskLevel === 'HIGH' || riskLevel === 'CRITICAL',
    auditEventType: name.split('.').pop()?.toUpperCase() ?? 'APPLICATION',
    timeoutMs: 20000,
    retryable: false,
    handler,
    ...opts,
  };
}

async function resolveName(client: any, guildId: string, userId: string): Promise<string> {
  try {
    const guild = await fetchGuild(client, guildId);
    const member = await guild.members.fetch(userId);
    return member.user?.tag ?? member.user?.username ?? userId;
  } catch {
    return userId;
  }
}

function panelQuestions(questions: unknown): any[] {
  return Array.isArray(questions) ? (questions as any[]) : [];
}

export function registerApplicationTools(registry: any): void {
  registry.register(registration(
    'applications.createApplicationPanel',
    'Create an application panel with an interactive button',
    createApplicationPanelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);

      const panel = await prisma.applicationPanel.create({
        data: {
          guildId: context.guildId,
          type: input.type,
          title: input.title,
          description: input.description,
          questions: (input.questions ?? []) as any,
          channelId: input.channelId,
          messageId: '',
          reviewRoles: input.reviewRoles ?? [],
          maxApplications: input.maxApplications,
          expireAfterDays: input.expireAfterDays,
          status: 'ACTIVE',
        },
      });

      const embed = new EmbedBuilder()
        .setTitle(input.title)
        .setDescription(input.description)
        .setColor(0x5865f2);

      const button = new ButtonBuilder()
        .setCustomId(`applications:apply:${panel.id}`)
        .setLabel('Apply')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

      const message = await channel.send({ embeds: [embed], components: [row] });

      await prisma.applicationPanel.update({
        where: { id: panel.id },
        data: { messageId: message.id },
      });

      return {
        success: true,
        panelId: panel.id,
        messageId: message.id,
        channelId: input.channelId,
      };
    }
  ));

  registry.register(registration(
    'applications.submitApplication',
    'Submit an application for an open panel',
    submitApplicationSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const panel = await prisma.applicationPanel.findFirst({
        where: { id: input.panelId, guildId: context.guildId },
      });
      if (!panel) throw new Error('Application panel not found');

      const result = await prisma.application.aggregate({
        where: { guildId: context.guildId },
        _max: { number: true },
      });
      const number = (result._max.number ?? 0) + 1;
      const applicantName = await resolveName(context.discordClient, context.guildId, input.applicantId);

      const application = await prisma.application.create({
        data: {
          guildId: context.guildId,
          number,
          panelId: panel.id,
          type: panel.type,
          status: 'PENDING',
          applicantId: input.applicantId,
          applicantName,
          answers: (input.answers ?? {}) as any,
        },
      });

      return {
        success: true,
        applicationId: application.id,
        applicationNumber: application.number,
        status: application.status,
      };
    }
  ));

  registry.register(registration(
    'applications.reviewApplication',
    'Add a review to an application',
    reviewApplicationSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const application = await prisma.application.findFirst({
        where: { id: input.applicationId, guildId: context.guildId },
      });
      if (!application) throw new Error('Application not found');

      const reviewerName = await resolveName(context.discordClient, context.guildId, input.reviewerId);

      const review = await prisma.applicationReview.create({
        data: {
          applicationId: application.id,
          reviewerId: input.reviewerId,
          reviewerName,
          score: input.score,
          notes: input.notes,
          decision: input.decision,
        },
      });

      const status = input.decision === 'ACCEPT' ? 'UNDER_REVIEW' : application.status;
      await prisma.application.update({
        where: { id: application.id },
        data: {
          reviewerId: input.reviewerId,
          reviewerName,
          reviewNotes: input.notes,
          reviewScore: input.score,
          status,
          reviewedAt: new Date(),
        },
      });

      return { success: true, applicationId: application.id, status, reviewId: review.id };
    }
  ));

  registry.register(registration(
    'applications.decideApplication',
    'Record a final decision on an application',
    decideApplicationSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const application = await prisma.application.findFirst({
        where: { id: input.applicationId, guildId: context.guildId },
      });
      if (!application) throw new Error('Application not found');

      const decidedAt = new Date();
      await prisma.application.update({
        where: { id: application.id },
        data: {
          status: input.decision,
          decidedBy: input.decidedBy,
          decidedAt,
          decisionReason: input.reason,
        },
      });

      return {
        success: true,
        applicationId: application.id,
        status: input.decision,
        decidedAt: decidedAt.toISOString(),
      };
    }
  ));

  registry.register(registration(
    'applications.getApplication',
    'Get an application with its reviews',
    getApplicationSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const application = await prisma.application.findFirst({
        where: { id: input.applicationId, guildId: context.guildId },
        include: { reviews: { orderBy: { createdAt: 'asc' } } },
      });
      if (!application) throw new Error('Application not found');

      return {
        application: {
          id: application.id,
          number: application.number,
          type: application.type,
          status: application.status,
          applicantId: application.applicantId,
          applicantName: application.applicantName,
          answers: (application.answers ?? {}) as Record<string, unknown>,
          reviewerId: application.reviewerId,
          reviewerName: application.reviewerName,
          reviewNotes: application.reviewNotes,
          reviewScore: application.reviewScore,
          decidedBy: application.decidedBy,
          decidedAt: application.decidedAt?.toISOString() ?? null,
          decisionReason: application.decisionReason,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: application.reviewedAt?.toISOString() ?? null,
        },
        reviews: application.reviews.map((r) => ({
          id: r.id,
          reviewerId: r.reviewerId,
          reviewerName: r.reviewerName,
          score: r.score,
          notes: r.notes,
          decision: r.decision,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'applications.listApplications',
    'List applications with optional filters',
    listApplicationsSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: context.guildId };
      if (input.status) where.status = input.status;
      if (input.type) where.type = input.type;
      if (input.applicantId) where.applicantId = input.applicantId;
      if (input.reviewerId) where.reviewerId = input.reviewerId;

      const [applications, total] = await Promise.all([
        prisma.application.findMany({
          where,
          orderBy: { submittedAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.application.count({ where }),
      ]);

      return {
        applications: applications.map((a) => ({
          id: a.id,
          number: a.number,
          type: a.type,
          status: a.status,
          applicantId: a.applicantId,
          applicantName: a.applicantName,
          reviewerId: a.reviewerId,
          submittedAt: a.submittedAt.toISOString(),
          reviewedAt: a.reviewedAt?.toISOString() ?? null,
        })),
        total,
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'applications.getApplicationPanel',
    'Get an application panel definition',
    getApplicationPanelSchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const panel = await prisma.applicationPanel.findFirst({
        where: { id: input.panelId, guildId: context.guildId },
      });
      if (!panel) throw new Error('Application panel not found');

      return {
        panel: {
          id: panel.id,
          type: panel.type,
          title: panel.title,
          description: panel.description,
          questions: panelQuestions(panel.questions),
          channelId: panel.channelId,
          messageId: panel.messageId,
          reviewRoles: panel.reviewRoles,
          maxApplications: panel.maxApplications,
          expireAfterDays: panel.expireAfterDays,
          createdAt: panel.createdAt.toISOString(),
        },
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'applications.listApplicationPanels',
    'List all application panels in the guild',
    listApplicationPanelsSchema,
    'NONE',
    async (_input: any, context: ToolContext) => {
      const panels = await prisma.applicationPanel.findMany({
        where: { guildId: context.guildId },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { applications: true } } },
      });

      return {
        panels: panels.map((p) => ({
          id: p.id,
          type: p.type,
          title: p.title,
          channelId: p.channelId,
          status: p.status as 'ACTIVE' | 'CLOSED' | 'EXPIRED',
          applicationCount: p._count.applications,
          createdAt: p.createdAt.toISOString(),
        })),
      };
    },
    { readOnly: true }
  ));
}
