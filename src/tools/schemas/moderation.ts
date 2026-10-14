import { z } from 'zod';
import { commonSchemas } from '../registry.js';

export const timeoutMemberSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    durationMs: commonSchemas.durationMs,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    durationMs: z.number(),
    expiresAt: z.string(),
    reason: z.string().nullable(),
  }),
};

export const removeTimeoutSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    reason: z.string().nullable(),
  }),
};

export const kickMemberSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    reason: z.string().nullable(),
  }),
};

export const banMemberSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    reason: commonSchemas.reason,
    deleteMessageDays: z.number().int().min(0).max(7).default(0),
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    reason: z.string().nullable(),
    deleteMessageDays: z.number(),
  }),
};

export const unbanMemberSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    reason: z.string().nullable(),
  }),
};

export const addRoleSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    roleId: commonSchemas.roleId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    roleId: z.string(),
    reason: z.string().nullable(),
  }),
};

export const removeRoleSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    roleId: commonSchemas.roleId,
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    roleId: z.string(),
    reason: z.string().nullable(),
  }),
};

export const setNicknameSchema = {
  input: z.object({
    userId: commonSchemas.userId,
    nickname: z.string().max(32).nullable(),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    userId: z.string(),
    nickname: z.string().nullable(),
    reason: z.string().nullable(),
  }),
};

export const deleteMessagesSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    messageIds: z.array(commonSchemas.messageId).min(1).max(100),
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    deletedCount: z.number(),
    failedIds: z.array(z.string()),
    reason: z.string().nullable(),
  }),
};

export const purgeMessagesSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    limit: z.number().int().positive().max(100).default(50),
    filter: z.object({
      userId: commonSchemas.userId.optional(),
      botOnly: z.boolean().optional(),
      hasAttachments: z.boolean().optional(),
      hasEmbeds: z.boolean().optional(),
      contains: z.string().optional(),
      before: commonSchemas.messageId.optional(),
      after: commonSchemas.messageId.optional(),
    }).optional(),
    reason: commonSchemas.reason,
    dryRun: z.boolean().default(false),
  }),
  output: z.object({
    success: z.boolean(),
    deletedCount: z.number(),
    messages: z.array(z.object({
      id: z.string(),
      authorId: z.string(),
      content: z.string(),
      timestamp: z.string(),
    })).optional(),
    reason: z.string().nullable(),
    dryRun: z.boolean(),
  }),
};

export const setSlowmodeSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    seconds: z.number().int().min(0).max(21600), // 6 hours max
    reason: commonSchemas.reason,
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    seconds: z.number(),
    reason: z.string().nullable(),
  }),
};

export const lockChannelSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    reason: commonSchemas.reason,
    targetRoleId: commonSchemas.roleId.optional(), // Default @everyone
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    reason: z.string().nullable(),
    previousOverwrites: z.array(z.object({
      id: z.string(),
      type: z.number(),
      allow: z.string(),
      deny: z.string(),
    })),
  }),
};

export const unlockChannelSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
    reason: commonSchemas.reason,
    targetRoleId: commonSchemas.roleId.optional(),
  }),
  output: z.object({
    success: z.boolean(),
    channelId: z.string(),
    reason: z.string().nullable(),
    restoredOverwrites: z.array(z.object({
      id: z.string(),
      type: z.number(),
      allow: z.string(),
      deny: z.string(),
    })),
  }),
};

export const createModerationCaseSchema = {
  input: z.object({
    type: z.enum(['WARNING', 'TIMEOUT', 'KICK', 'BAN', 'ROLE_CHANGE', 'NICKNAME_CHANGE', 'MESSAGE_DELETE', 'CHANNEL_LOCK', 'SPAM', 'RAID', 'HARASSMENT', 'CUSTOM']),
    subjectId: commonSchemas.userId,
    subjectName: z.string().max(100),
    reason: z.string().max(1000),
    evidence: z.array(z.object({
      type: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })).optional(),
    notes: z.string().max(2000).optional(),
    assignedToId: commonSchemas.userId.optional(),
  }),
  output: z.object({
    caseId: z.string(),
    caseNumber: z.number(),
    type: z.string(),
    status: z.string(),
    subjectId: z.string(),
    reason: z.string(),
    createdAt: z.string(),
  }),
};

export const addCaseEvidenceSchema = {
  input: z.object({
    caseId: z.string(),
    evidence: z.array(z.object({
      type: z.string(),
      value: z.string(),
      description: z.string().optional(),
    })),
    notes: z.string().max(2000).optional(),
  }),
  output: z.object({
    success: z.boolean(),
    caseId: z.string(),
    evidenceCount: z.number(),
  }),
};

export const getCaseHistorySchema = {
  input: z.object({
    userId: commonSchemas.userId.optional(),
    guildId: commonSchemas.guildId.optional(),
    status: z.enum(['OPEN', 'INVESTIGATING', 'PENDING_REVIEW', 'RESOLVED', 'CLOSED', 'APPEALED']).optional(),
    limit: z.number().int().positive().max(100).default(25),
    offset: z.number().int().min(0).default(0),
  }),
  output: z.object({
    cases: z.array(z.object({
      id: z.string(),
      number: z.number(),
      type: z.string(),
      status: z.string(),
      subjectId: z.string(),
      subjectName: z.string(),
      reason: z.string(),
      openedAt: z.string(),
      closedAt: z.string().nullable(),
    })),
    total: z.number(),
  }),
};

export const appealCaseSchema = {
  input: z.object({
    caseId: z.string(),
    reason: z.string().max(2000),
  }),
  output: z.object({
    success: z.boolean(),
    caseId: z.string(),
    appealStatus: z.string(),
  }),
};

export const resolveAppealSchema = {
  input: z.object({
    caseId: z.string(),
    decision: z.enum(['APPROVED', 'DENIED']),
    reason: z.string().max(2000),
  }),
  output: z.object({
    success: z.boolean(),
    caseId: z.string(),
    appealStatus: z.string(),
  }),
};