import { ToolRegistration, ToolContext } from '../registry.js';
import { prisma } from '../../db/client.js';
import { logger } from '../../observability/logger.js';
import { getGuildInfoSchema } from '../schemas/discord.js';
import { getMemberInfoSchema } from '../schemas/discord.js';
import { getChannelInfoSchema } from '../schemas/discord.js';
import { getRoleInfoSchema } from '../schemas/discord.js';
import { searchMembersSchema } from '../schemas/discord.js';
import { getAuditLogSchema } from '../schemas/discord.js';
import { getBotPermissionsSchema } from '../schemas/discord.js';
import { comparePermissionsSchema } from '../schemas/discord.js';

export function registerDiscordTools(registry: any): void {
  // getGuildInfo
  registry.register({
    name: 'discord.getGuildInfo',
    version: '1.0.0',
    description: 'Get comprehensive information about the current guild/server',
    inputSchema: getGuildInfoSchema.input,
    outputSchema: getGuildInfoSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'GUILD_INFO_READ',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const roles = guild.roles.cache.map(r => ({
        id: r.id,
        name: r.name,
        color: r.color,
        position: r.position,
        permissions: r.permissions.toString(),
        managed: r.managed,
        mentionable: r.mentionable,
      })).sort((a, b) => b.position - a.position);

      const channels = guild.channels.cache.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
        position: c.rawPosition ?? 0,
        permissionOverwrites: c.permissionOverwrites.cache.map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow.toString(),
          deny: o.deny.toString(),
        })),
      }));

      return {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        ownerId: guild.ownerId,
        createdAt: guild.createdAt.toISOString(),
        features: guild.features,
        verificationLevel: guild.verificationLevel,
        defaultMessageNotifications: guild.defaultMessageNotifications,
        explicitContentFilter: guild.explicitContentFilter,
        roles,
        channels,
      };
    },
  });

  // getMemberInfo
  registry.register({
    name: 'discord.getMemberInfo',
    version: '1.0.0',
    description: 'Get detailed information about a guild member',
    inputSchema: getMemberInfoSchema.input,
    outputSchema: getMemberInfoSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'MEMBER_INFO_READ',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const member = await guild.members.fetch(input.userId);
      
      if (!member) {
        throw new Error('Member not found');
      }

      return {
        user: {
          id: member.user.id,
          username: member.user.username,
          globalName: member.user.globalName,
          discriminator: member.user.discriminator,
          avatar: member.user.avatar,
          bot: member.user.bot,
          system: member.user.system,
          createdAt: member.user.createdAt.toISOString(),
        },
        member: {
          nick: member.nick,
          roles: member.roles.cache.map(r => r.id),
          joinedAt: member.joinedAt?.toISOString() ?? null,
          premiumSince: member.premiumSince?.toISOString() ?? null,
          pending: member.pending,
          permissions: member.permissions.toString(),
          communicationDisabledUntil: member.communicationDisabledUntil?.toISOString() ?? null,
        },
      };
    },
  });

  // getChannelInfo
  registry.register({
    name: 'discord.getChannelInfo',
    version: '1.0.0',
    description: 'Get detailed information about a channel',
    inputSchema: getChannelInfoSchema.input,
    outputSchema: getChannelInfoSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'CHANNEL_INFO_READ',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const channel = await client.channels.fetch(input.channelId);
      
      if (!channel || !channel.isTextBased()) {
        throw new Error('Channel not found or not a text channel');
      }

      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId,
        position: channel.rawPosition ?? 0,
        topic: 'topic' in channel ? channel.topic : null,
        nsfw: 'nsfw' in channel ? channel.nsfw : false,
        rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,
        permissionOverwrites: channel.permissionOverwrites.cache.map(o => ({
          id: o.id,
          type: o.type,
          allow: o.allow.toString(),
          deny: o.deny.toString(),
        })),
      };
    },
  });

  // getRoleInfo
  registry.register({
    name: 'discord.getRoleInfo',
    version: '1.0.0',
    description: 'Get detailed information about a role',
    inputSchema: getRoleInfoSchema.input,
    outputSchema: getRoleInfoSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'ROLE_INFO_READ',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const role = guild.roles.cache.get(input.roleId);
      
      if (!role) {
        throw new Error('Role not found');
      }

      const members = role.members.map(m => m.id);

      return {
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        permissions: role.permissions.toString(),
        managed: role.managed,
        mentionable: role.mentionable,
        members,
      };
    },
  });

  // searchMembers
  registry.register({
    name: 'discord.searchMembers',
    version: '1.0.0',
    description: 'Search for members by username, display name, or nickname',
    inputSchema: searchMembersSchema.input,
    outputSchema: searchMembersSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'MEMBER_SEARCH',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const query = input.query.toLowerCase();
      const members = guild.members.cache
        .filter(m => 
          m.user.username.toLowerCase().includes(query) ||
          m.user.globalName?.toLowerCase().includes(query) ||
          m.nickname?.toLowerCase().includes(query) ||
          m.user.id === query
        )
        .slice(0, input.limit)
        .map(m => ({
          id: m.id,
          username: m.user.username,
          globalName: m.user.globalName,
          discriminator: m.user.discriminator,
          nick: m.nick,
          roles: m.roles.cache.map(r => r.id),
          joinedAt: m.joinedAt?.toISOString() ?? null,
        }));

      return { members };
    },
  });

  // getAuditLog
  registry.register({
    name: 'discord.getAuditLog',
    version: '1.0.0',
    description: 'Fetch audit log entries for investigation',
    inputSchema: getAuditLogSchema.input,
    outputSchema: getAuditLogSchema.output,
    readOnly: true,
    riskLevel: 'LOW',
    requiredPermissions: ['ViewAuditLog'],
    requiredUserPermissions: ['ViewAuditLog'],
    confirmationRequired: false,
    auditEventType: 'AUDIT_LOG_READ',
    timeoutMs: 15000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const auditLogs = await guild.fetchAuditLogs({
        limit: input.limit,
        before: input.before,
        after: input.after,
        user: input.userId,
        type: input.actionType as any,
      });

      const entries = auditLogs.entries
        .filter(e => {
          if (input.targetId && e.targetId !== input.targetId) return false;
          return true;
        })
        .map(e => ({
          id: e.id,
          actionType: e.action.toString(),
          userId: e.executor?.id ?? 'unknown',
          targetId: e.target?.id ?? 'unknown',
          changes: e.changes.map(c => ({
            key: c.key,
            oldValue: c.old,
            newValue: c.new,
          })),
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
        }));

      return { entries };
    },
  });

  // getBotPermissions
  registry.register({
    name: 'discord.getBotPermissions',
    version: '1.0.0',
    description: 'Check bot permissions in the guild or a specific channel',
    inputSchema: getBotPermissionsSchema.input,
    outputSchema: getBotPermissionsSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'BOT_PERMISSIONS_READ',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const me = await guild.members.fetchMe();
      const permissions = me.permissions;

      let channelPermissions = permissions;
      if (input.channelId) {
        const channel = guild.channels.cache.get(input.channelId);
        if (channel && channel.isTextBased()) {
          channelPermissions = channel.permissionsFor(me) ?? permissions;
        }
      }

      return {
        permissions: channelPermissions.toString(),
        missingPermissions: [], // Would need to check against required permissions
        highestRolePosition: me.roles.highest.position,
        canManageRoles: channelPermissions.has('ManageRoles'),
        canManageChannels: channelPermissions.has('ManageChannels'),
        canModerateMembers: channelPermissions.has('ModerateMembers'),
        canBanMembers: channelPermissions.has('BanMembers'),
        canKickMembers: channelPermissions.has('KickMembers'),
        canManageMessages: channelPermissions.has('ManageMessages'),
        canViewAuditLog: channelPermissions.has('ViewAuditLog'),
      };
    },
  });

  // comparePermissions
  registry.register({
    name: 'discord.comparePermissions',
    version: '1.0.0',
    description: 'Compare permission overwrites between two channels',
    inputSchema: comparePermissionsSchema.input,
    outputSchema: comparePermissionsSchema.output,
    readOnly: true,
    riskLevel: 'NONE',
    requiredPermissions: [],
    requiredUserPermissions: [],
    confirmationRequired: false,
    auditEventType: 'PERMISSIONS_COMPARE',
    timeoutMs: 10000,
    retryable: true,
    handler: async (input: any, context: ToolContext) => {
      const client = context.discordClient;
      const guild = await client.guilds.fetch(context.guildId);
      
      if (!guild) {
        throw new Error('Guild not found');
      }

      const channel1 = guild.channels.cache.get(input.channelId1);
      const channel2 = guild.channels.cache.get(input.channelId2);

      if (!channel1 || !channel2 || !channel1.isTextBased() || !channel2.isTextBased()) {
        throw new Error('One or both channels not found or not text channels');
      }

      const overwrites1 = channel1.permissionOverwrites.cache.map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow.toString(),
        deny: o.deny.toString(),
      }));

      const overwrites2 = channel2.permissionOverwrites.cache.map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow.toString(),
        deny: o.deny.toString(),
      }));

      // Find differences
      const allIds = new Set([...overwrites1.map(o => o.id), ...overwrites2.map(o => o.id)]);
      const differences: any[] = [];

      for (const id of allIds) {
        const o1 = overwrites1.find(o => o.id === id);
        const o2 = overwrites2.find(o => o.id === id);
        
        if (!o1 || !o2 || o1.allow !== o2.allow || o1.deny !== o2.deny) {
          differences.push({
            targetId: id,
            targetType: o1?.type ?? o2?.type ?? 0,
            channel1Allow: o1?.allow ?? null,
            channel1Deny: o1?.deny ?? null,
            channel2Allow: o2?.allow ?? null,
            channel2Deny: o2?.deny ?? null,
          });
        }
      }

      return {
        channel1: {
          id: channel1.id,
          name: channel1.name,
          overwrites: overwrites1,
        },
        channel2: {
          id: channel2.id,
          name: channel2.name,
          overwrites: overwrites2,
        },
        differences,
      };
    },
  });
}