import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import {
  fetchGuild,
  fetchMember,
  fetchTextChannel,
  mapOverwrite,
  isoSafe,
} from '../helpers.js';
import {
  timeoutMemberSchema,
  removeTimeoutSchema,
  kickMemberSchema,
  banMemberSchema,
  unbanMemberSchema,
  addRoleSchema,
  removeRoleSchema,
  setNicknameSchema,
  deleteMessagesSchema,
  purgeMessagesSchema,
  setSlowmodeSchema,
  lockChannelSchema,
  unlockChannelSchema,
  createModerationCaseSchema,
  addCaseEvidenceSchema,
  getCaseHistorySchema,
  appealCaseSchema,
  resolveAppealSchema,
} from '../schemas/moderation.js';

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
    auditEventType: name.split('.').pop()?.toUpperCase() ?? 'MODERATION',
    timeoutMs: 15000,
    retryable: false,
    handler,
    ...opts,
  };
}

export function registerModerationTools(registry: any): void {
  registry.register(registration(
    'moderation.timeoutMember',
    'Timeout (mute) a guild member for a duration',
    timeoutMemberSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.timeout(input.durationMs, input.reason ?? undefined);
      const expiresAt = new Date(Date.now() + input.durationMs);
      return {
        success: true,
        userId: input.userId,
        durationMs: input.durationMs,
        expiresAt: expiresAt.toISOString(),
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.removeTimeout',
    'Remove a timeout from a guild member',
    removeTimeoutSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.timeout(null, input.reason ?? undefined);
      return { success: true, userId: input.userId, reason: input.reason ?? null };
    }
  ));

  registry.register(registration(
    'moderation.kickMember',
    'Kick a member from the guild',
    kickMemberSchema,
    'HIGH',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.kick(input.reason ?? undefined);
      return { success: true, userId: input.userId, reason: input.reason ?? null };
    }
  ));

  registry.register(registration(
    'moderation.banMember',
    'Ban a user from the guild, optionally deleting recent messages',
    banMemberSchema,
    'HIGH',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const deleteMessageSeconds = (input.deleteMessageDays ?? 0) * 24 * 60 * 60;
      await guild.members.ban(input.userId, {
        deleteMessageSeconds,
        reason: input.reason ?? undefined,
      });
      return {
        success: true,
        userId: input.userId,
        reason: input.reason ?? null,
        deleteMessageDays: input.deleteMessageDays ?? 0,
      };
    }
  ));

  registry.register(registration(
    'moderation.unbanMember',
    'Unban a user from the guild',
    unbanMemberSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const guild = await fetchGuild(context.discordClient, context.guildId);
      await guild.members.unban(input.userId, input.reason ?? undefined);
      return { success: true, userId: input.userId, reason: input.reason ?? null };
    }
  ));

  registry.register(registration(
    'moderation.addRole',
    'Add a role to a guild member',
    addRoleSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.roles.add(input.roleId, input.reason ?? undefined);
      return {
        success: true,
        userId: input.userId,
        roleId: input.roleId,
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.removeRole',
    'Remove a role from a guild member',
    removeRoleSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.roles.remove(input.roleId, input.reason ?? undefined);
      return {
        success: true,
        userId: input.userId,
        roleId: input.roleId,
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.setNickname',
    'Set or clear a guild member nickname',
    setNicknameSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const member = await fetchMember(context.discordClient, context.guildId, input.userId);
      await member.setNickname(input.nickname, input.reason ?? undefined);
      return {
        success: true,
        userId: input.userId,
        nickname: input.nickname ?? null,
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.deleteMessages',
    'Delete a specific set of messages from a channel',
    deleteMessagesSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const deleted: any = await channel.bulkDelete(input.messageIds, true);
      const failedIds = input.messageIds.filter((id: string) => !deleted.has(id));
      return {
        success: true,
        deletedCount: deleted.size,
        failedIds,
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.purgeMessages',
    'Bulk delete messages with optional filters (supports dry run)',
    purgeMessagesSchema,
    'HIGH',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const filter = input.filter ?? {};

      const fetched: any = await channel.messages.fetch({
        limit: input.limit,
        before: filter.before,
        after: filter.after,
      });

      let messages = Array.from(fetched.values()) as any[];

      if (filter.userId) {
        messages = messages.filter((m) => m.author?.id === filter.userId);
      }
      if (filter.botOnly) {
        messages = messages.filter((m) => m.author?.bot === true);
      }
      if (filter.hasAttachments) {
        messages = messages.filter((m) => (m.attachments?.size ?? 0) > 0);
      }
      if (filter.hasEmbeds) {
        messages = messages.filter((m) => (m.embeds?.length ?? 0) > 0);
      }
      if (filter.contains) {
        const needle = String(filter.contains).toLowerCase();
        messages = messages.filter((m) => (m.content ?? '').toLowerCase().includes(needle));
      }

      const preview = messages.map((m) => ({
        id: m.id,
        authorId: m.author?.id ?? 'unknown',
        content: m.content ?? '',
        timestamp: isoSafe(m.createdAt),
      }));

      if (input.dryRun) {
        return {
          success: true,
          deletedCount: 0,
          messages: preview,
          reason: input.reason ?? null,
          dryRun: true,
        };
      }

      if (messages.length > 0) {
        await channel.bulkDelete(messages, true);
      }

      return {
        success: true,
        deletedCount: messages.length,
        messages: preview,
        reason: input.reason ?? null,
        dryRun: false,
      };
    }
  ));

  registry.register(registration(
    'moderation.setSlowmode',
    'Set slowmode (rate limit per user) on a channel',
    setSlowmodeSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      await channel.setRateLimitPerUser(input.seconds, input.reason ?? undefined);
      return {
        success: true,
        channelId: input.channelId,
        seconds: input.seconds,
        reason: input.reason ?? null,
      };
    }
  ));

  registry.register(registration(
    'moderation.lockChannel',
    'Lock a channel by denying SendMessages for a role (default @everyone)',
    lockChannelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const targetRoleId = input.targetRoleId ?? guild.roles.everyone.id;

      const existing = channel.permissionOverwrites.cache.get(targetRoleId);
      const previousOverwrites = existing ? [mapOverwrite(existing)] : [];

      await channel.permissionOverwrites.edit(
        targetRoleId,
        { SendMessages: false },
        { reason: input.reason ?? undefined }
      );

      return {
        success: true,
        channelId: input.channelId,
        reason: input.reason ?? null,
        previousOverwrites,
      };
    }
  ));

  registry.register(registration(
    'moderation.unlockChannel',
    'Unlock a channel by resetting the SendMessages overwrite for a role',
    unlockChannelSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const channel = await fetchTextChannel(context.discordClient, input.channelId);
      const guild = await fetchGuild(context.discordClient, context.guildId);
      const targetRoleId = input.targetRoleId ?? guild.roles.everyone.id;

      await channel.permissionOverwrites.edit(
        targetRoleId,
        { SendMessages: null },
        { reason: input.reason ?? undefined }
      );

      const updated = channel.permissionOverwrites.cache.get(targetRoleId);
      const restoredOverwrites = updated ? [mapOverwrite(updated)] : [];

      return {
        success: true,
        channelId: input.channelId,
        reason: input.reason ?? null,
        restoredOverwrites,
      };
    }
  ));

  registry.register(registration(
    'moderation.createModerationCase',
    'Create a moderation case record for tracking and auditing',
    createModerationCaseSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const number = await nextCaseNumber(context.guildId);
      const created = await prisma.moderationCase.create({
        data: {
          guildId: context.guildId,
          number,
          type: input.type,
          status: 'OPEN',
          subjectId: input.subjectId,
          subjectName: input.subjectName,
          reason: input.reason,
          evidence: (input.evidence ?? []) as any,
          notes: input.notes,
          assignedToId: input.assignedToId,
        },
      });
      return {
        caseId: created.id,
        caseNumber: created.number,
        type: created.type,
        status: created.status,
        subjectId: created.subjectId,
        reason: created.reason,
        createdAt: created.createdAt.toISOString(),
      };
    }
  ));

  registry.register(registration(
    'moderation.addCaseEvidence',
    'Append evidence and/or notes to an existing moderation case',
    addCaseEvidenceSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const existing = await prisma.moderationCase.findFirst({
        where: { id: input.caseId, guildId: context.guildId },
      });
      if (!existing) throw new Error('Moderation case not found');

      const currentEvidence = Array.isArray(existing.evidence) ? (existing.evidence as any[]) : [];
      const evidence = [...currentEvidence, ...(input.evidence ?? [])];
      const notes = input.notes
        ? [existing.notes, input.notes].filter(Boolean).join('\n')
        : existing.notes;

      await prisma.moderationCase.update({
        where: { id: existing.id },
        data: { evidence: evidence as any, notes },
      });

      return { success: true, caseId: existing.id, evidenceCount: evidence.length };
    }
  ));

  registry.register(registration(
    'moderation.getCaseHistory',
    'Retrieve moderation case history with optional filters',
    getCaseHistorySchema,
    'NONE',
    async (input: any, context: ToolContext) => {
      const where: any = { guildId: input.guildId ?? context.guildId };
      if (input.userId) where.subjectId = input.userId;
      if (input.status) where.status = input.status;

      const [cases, total] = await Promise.all([
        prisma.moderationCase.findMany({
          where,
          orderBy: { openedAt: 'desc' },
          take: input.limit,
          skip: input.offset,
        }),
        prisma.moderationCase.count({ where }),
      ]);

      return {
        cases: cases.map((c) => ({
          id: c.id,
          number: c.number,
          type: c.type,
          status: c.status,
          subjectId: c.subjectId,
          subjectName: c.subjectName,
          reason: c.reason,
          openedAt: c.openedAt.toISOString(),
          closedAt: c.closedAt?.toISOString() ?? null,
        })),
        total,
      };
    },
    { readOnly: true }
  ));

  registry.register(registration(
    'moderation.appealCase',
    'Submit an appeal for a moderation case',
    appealCaseSchema,
    'LOW',
    async (input: any, context: ToolContext) => {
      const existing = await prisma.moderationCase.findFirst({
        where: { id: input.caseId, guildId: context.guildId },
      });
      if (!existing) throw new Error('Moderation case not found');

      await prisma.moderationCase.update({
        where: { id: existing.id },
        data: {
          status: 'APPEALED',
          appealStatus: 'PENDING',
          appealReason: input.reason,
        },
      });

      return { success: true, caseId: existing.id, appealStatus: 'PENDING' };
    }
  ));

  registry.register(registration(
    'moderation.resolveAppeal',
    'Approve or deny an appeal for a moderation case',
    resolveAppealSchema,
    'MEDIUM',
    async (input: any, context: ToolContext) => {
      const existing = await prisma.moderationCase.findFirst({
        where: { id: input.caseId, guildId: context.guildId },
      });
      if (!existing) throw new Error('Moderation case not found');

      const status = input.decision === 'APPROVED' ? 'RESOLVED' : 'CLOSED';
      await prisma.moderationCase.update({
        where: { id: existing.id },
        data: {
          status,
          appealStatus: input.decision,
          appealDecision: input.reason,
          closedAt: new Date(),
        },
      });

      return { success: true, caseId: existing.id, appealStatus: input.decision };
    }
  ));
}

async function nextCaseNumber(guildId: string): Promise<number> {
  const result = await prisma.moderationCase.aggregate({
    where: { guildId },
    _max: { number: true },
  });
  return (result._max.number ?? 0) + 1;
}
