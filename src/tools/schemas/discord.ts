import { z } from 'zod';
import { commonSchemas } from '../registry.js';

// Discord read-only tools
export const getGuildInfoSchema = {
  input: z.object({}),
  output: z.object({
    id: z.string(),
    name: z.string(),
    memberCount: z.number(),
    ownerId: z.string(),
    createdAt: z.string(),
    features: z.array(z.string()),
    verificationLevel: z.number(),
    defaultMessageNotifications: z.number(),
    explicitContentFilter: z.number(),
    roles: z.array(z.object({
      id: z.string(),
      name: z.string(),
      color: z.number(),
      position: z.number(),
      permissions: z.string(),
      managed: z.boolean(),
      mentionable: z.boolean(),
    })),
    channels: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.number(),
      parentId: z.string().nullable(),
      position: z.number(),
      permissionOverwrites: z.array(z.object({
        id: z.string(),
        type: z.number(),
        allow: z.string(),
        deny: z.string(),
      })),
    })),
  }),
};

export const getMemberInfoSchema = {
  input: z.object({
    userId: commonSchemas.userId,
  }),
  output: z.object({
    user: z.object({
      id: z.string(),
      username: z.string(),
      globalName: z.string().nullable(),
      discriminator: z.string(),
      avatar: z.string().nullable(),
      bot: z.boolean(),
      system: z.boolean(),
      createdAt: z.string(),
    }),
    member: z.object({
      nick: z.string().nullable(),
      roles: z.array(z.string()),
      joinedAt: z.string().nullable(),
      premiumSince: z.string().nullable(),
      pending: z.boolean(),
      permissions: z.string(),
      communicationDisabledUntil: z.string().nullable(),
    }).nullable(),
  }),
};

export const getChannelInfoSchema = {
  input: z.object({
    channelId: commonSchemas.channelId,
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    type: z.number(),
    parentId: z.string().nullable(),
    position: z.number(),
    topic: z.string().nullable(),
    nsfw: z.boolean(),
    rateLimitPerUser: z.number(),
    permissionOverwrites: z.array(z.object({
      id: z.string(),
      type: z.number(),
      allow: z.string(),
      deny: z.string(),
    })),
  }),
};

export const getRoleInfoSchema = {
  input: z.object({
    roleId: commonSchemas.roleId,
  }),
  output: z.object({
    id: z.string(),
    name: z.string(),
    color: z.number(),
    position: z.number(),
    permissions: z.string(),
    managed: z.boolean(),
    mentionable: z.boolean(),
    members: z.array(z.string()),
  }),
};

export const searchMembersSchema = {
  input: z.object({
    query: z.string().min(1).max(100),
    limit: z.number().int().positive().max(100).default(25),
  }),
  output: z.object({
    members: z.array(z.object({
      id: z.string(),
      username: z.string(),
      globalName: z.string().nullable(),
      discriminator: z.string(),
      nick: z.string().nullable(),
      roles: z.array(z.string()),
      joinedAt: z.string().nullable(),
    })),
  }),
};

export const getAuditLogSchema = {
  input: z.object({
    actionType: z.string().optional(),
    userId: commonSchemas.userId.optional(),
    targetId: commonSchemas.snowflake.optional(),
    limit: z.number().int().positive().max(100).default(50),
    before: commonSchemas.snowflake.optional(),
    after: commonSchemas.snowflake.optional(),
  }),
  output: z.object({
    entries: z.array(z.object({
      id: z.string(),
      actionType: z.string(),
      userId: z.string(),
      targetId: z.string().nullable(),
      changes: z.array(z.object({
        key: z.string(),
        oldValue: z.unknown(),
        newValue: z.unknown(),
      })),
      reason: z.string().nullable(),
      createdAt: z.string(),
    })),
  }),
};

export const getBotPermissionsSchema = {
  input: z.object({
    channelId: commonSchemas.channelId.optional(),
  }),
  output: z.object({
    permissions: z.string(),
    missingPermissions: z.array(z.string()),
    highestRolePosition: z.number(),
    canManageRoles: z.boolean(),
    canManageChannels: z.boolean(),
    canModerateMembers: z.boolean(),
    canBanMembers: z.boolean(),
    canKickMembers: z.boolean(),
    canManageMessages: z.boolean(),
    canViewAuditLog: z.boolean(),
  }),
};

export const comparePermissionsSchema = {
  input: z.object({
    channelId1: commonSchemas.channelId,
    channelId2: commonSchemas.channelId,
  }),
  output: z.object({
    channel1: z.object({
      id: z.string(),
      name: z.string(),
      overwrites: z.array(z.object({
        id: z.string(),
        type: z.number(),
        allow: z.string(),
        deny: z.string(),
      })),
    }),
    channel2: z.object({
      id: z.string(),
      name: z.string(),
      overwrites: z.array(z.object({
        id: z.string(),
        type: z.number(),
        allow: z.string(),
        deny: z.string(),
      })),
    }),
    differences: z.array(z.object({
      targetId: z.string(),
      targetType: z.string(),
      channel1Allow: z.string().nullable(),
      channel1Deny: z.string().nullable(),
      channel2Allow: z.string().nullable(),
      channel2Deny: z.string().nullable(),
    })),
  }),
};