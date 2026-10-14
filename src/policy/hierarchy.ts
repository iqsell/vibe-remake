import { logger, createGuildLogger } from '../observability/logger.js';

export interface HierarchyCheckResult {
  allowed: boolean;
  reason?: string;
  botPosition: number;
  userPosition: number;
  targetPosition: number;
  targetType: 'USER' | 'ROLE';
}

export interface RoleHierarchyInfo {
  botHighestRole: { id: string; name: string; position: number } | null;
  userHighestRole: { id: string; name: string; position: number } | null;
  targetHighestRole: { id: string; name: string; position: number } | null;
}

export class HierarchyManager {
  async checkHierarchy(
    guildId: string,
    userId: string,
    targetId: string,
    targetType: 'USER' | 'ROLE',
    discordClient: any
  ): Promise<HierarchyCheckResult> {
    const guildLogger = createGuildLogger(guildId);

    try {
      const guild = await discordClient.guilds.fetch(guildId);
      if (!guild) {
        return { allowed: false, reason: 'Guild not found', botPosition: 0, userPosition: 0, targetPosition: 0, targetType };
      }

      const me = await guild.members.fetchMe();
      const botPosition = me.roles.highest.position;

      const member = await guild.members.fetch(userId);
      const userPosition = member.roles.highest.position;

      let targetPosition: number;
      let targetName: string;

      if (targetType === 'USER') {
        const targetMember = await guild.members.fetch(targetId);
        targetPosition = targetMember.roles.highest.position;
        targetName = targetMember.user.tag;
      } else {
        const targetRole = guild.roles.cache.get(targetId);
        if (!targetRole) {
          return { allowed: false, reason: 'Target role not found', botPosition, userPosition, targetPosition: 0, targetType };
        }
        targetPosition = targetRole.position;
        targetName = targetRole.name;
      }

      // Bot must be above target
      if (botPosition <= targetPosition) {
        return { 
          allowed: false, 
          reason: `Bot's highest role (${me.roles.highest.name}) is not above target ${targetType.toLowerCase()} (${targetName})`,
          botPosition,
          userPosition,
          targetPosition,
          targetType,
        };
      }

      // User must be above target (unless user is guild owner)
      if (member.id !== guild.ownerId && userPosition <= targetPosition) {
        return { 
          allowed: false, 
          reason: `Your highest role (${member.roles.highest.name}) is not above target ${targetType.toLowerCase()} (${targetName})`,
          botPosition,
          userPosition,
          targetPosition,
          targetType,
        };
      }

      return { allowed: true, botPosition, userPosition, targetPosition, targetType };
    } catch (error) {
      guildLogger.error({ err: error, target: 'policy.hierarchy' }, 'Hierarchy check failed');
      return { allowed: false, reason: 'Hierarchy check failed', botPosition: 0, userPosition: 0, targetPosition: 0, targetType };
    }
  }

  async getHierarchyInfo(
    guildId: string,
    userId: string,
    targetId?: string,
    targetType?: 'USER' | 'ROLE',
    discordClient?: any
  ): Promise<RoleHierarchyInfo> {
    try {
      if (!discordClient) {
        return { botHighestRole: null, userHighestRole: null, targetHighestRole: null };
      }

      const guild = await discordClient.guilds.fetch(guildId);
      if (!guild) return { botHighestRole: null, userHighestRole: null, targetHighestRole: null };

      const me = await guild.members.fetchMe();
      const member = await guild.members.fetch(userId);

      let targetHighestRole: RoleHierarchyInfo['targetHighestRole'] = null;
      if (targetId && targetType) {
        if (targetType === 'USER') {
          const targetMember = await guild.members.fetch(targetId);
          targetHighestRole = {
            id: targetMember.roles.highest.id,
            name: targetMember.roles.highest.name,
            position: targetMember.roles.highest.position,
          };
        } else {
          const targetRole = guild.roles.cache.get(targetId);
          if (targetRole) {
            targetHighestRole = {
              id: targetRole.id,
              name: targetRole.name,
              position: targetRole.position,
            };
          }
        }
      }

      return {
        botHighestRole: {
          id: me.roles.highest.id,
          name: me.roles.highest.name,
          position: me.roles.highest.position,
        },
        userHighestRole: {
          id: member.roles.highest.id,
          name: member.roles.highest.name,
          position: member.roles.highest.position,
        },
        targetHighestRole,
      };
    } catch (error) {
      logger.error({ err: error, target: 'policy.hierarchy' }, 'Failed to get hierarchy info');
      return { botHighestRole: null, userHighestRole: null, targetHighestRole: null };
    }
  }

  canAssignRole(botPosition: number, targetRolePosition: number): boolean {
    return botPosition > targetRolePosition;
  }

  canActOnMember(botPosition: number, userPosition: number, targetPosition: number, isOwner: boolean): boolean {
    if (isOwner) return true;
    return botPosition > targetPosition && userPosition > targetPosition;
  }

  canManageRole(botPosition: number, rolePosition: number): boolean {
    return botPosition > rolePosition;
  }
}

export const hierarchyManager = new HierarchyManager();