export enum ActionScope {
  SINGLE = 'SINGLE',      // Single target (user, channel, role)
  FEW = 'FEW',            // Few targets (2-10)
  MANY = 'MANY',          // Many targets (11-100)
  ALL = 'ALL',            // All targets (100+ or unbounded)
}

export interface ScopeAnalysis {
  scope: ActionScope;
  estimatedTargetCount: number;
  isBounded: boolean;
  requiresExplicitConfirmation: boolean;
  warnings: string[];
}

export function analyzeScope(
  toolName: string,
  args: Record<string, any>,
  guildMemberCount: number
): ScopeAnalysis {
  const warnings: string[] = [];
  let estimatedCount = 1;
  let isBounded = true;
  let requiresExplicitConfirmation = false;

  // Tool-specific scope analysis
  switch (toolName) {
    case 'purgeMessages': {
      const limit = args.limit ?? 50;
      estimatedCount = Math.min(limit, 100);
      isBounded = true;
      if (estimatedCount > 50) {
        warnings.push(`Will delete up to ${estimatedCount} messages`);
        requiresExplicitConfirmation = true;
      }
      break;
    }

    case 'timeoutMember':
    case 'kickMember':
    case 'banMember':
    case 'addRole':
    case 'removeRole':
    case 'setNickname':
    case 'removeTimeout':
    case 'unbanMember': {
      estimatedCount = 1;
      isBounded = true;
      break;
    }

    case 'deleteMessages': {
      estimatedCount = args.messageIds?.length ?? 1;
      isBounded = true;
      break;
    }

    case 'createChannel':
    case 'createCategory': {
      estimatedCount = 1;
      isBounded = true;
      break;
    }

    case 'deleteChannel':
    case 'deleteCategory': {
      estimatedCount = 1;
      isBounded = true;
      // Check if channel has messages
      warnings.push('Channel deletion is permanent');
      requiresExplicitConfirmation = true;
      break;
    }

    case 'applyServerLayout': {
      // This could affect many channels/categories
      estimatedCount = 10; // Rough estimate
      isBounded = true;
      warnings.push('Server layout changes affect multiple channels and categories');
      requiresExplicitConfirmation = true;
      break;
    }

    case 'proposeServerLayout': {
      estimatedCount = 0; // Read-only
      isBounded = true;
      break;
    }

    case 'setSlowmode':
    case 'lockChannel':
    case 'unlockChannel': {
      estimatedCount = 1;
      isBounded = true;
      break;
    }

    default: {
      // Default to single target
      estimatedCount = 1;
      isBounded = true;
    }
  }

  // Determine scope category
  let scope: ActionScope;
  if (estimatedCount === 1) scope = ActionScope.SINGLE;
  else if (estimatedCount <= 10) scope = ActionScope.FEW;
  else if (estimatedCount <= 100) scope = ActionScope.MANY;
  else scope = ActionScope.ALL;

  // Special case: if targeting @everyone or similar broad role
  if (args.targetRoleId === 'everyone' || args.roleId === 'everyone') {
    estimatedCount = guildMemberCount;
    scope = ActionScope.ALL;
    isBounded = false;
    warnings.push('Targets all members via @everyone role');
    requiresExplicitConfirmation = true;
  }

  return {
    scope,
    estimatedTargetCount: estimatedCount,
    isBounded,
    requiresExplicitConfirmation,
    warnings,
  };
}

export function getScopeRequirements(scope: ActionScope): {
  minRoleLevel: string;
  requiresApproval: boolean;
  maxAutoExecute: number;
} {
  switch (scope) {
    case ActionScope.SINGLE:
      return { minRoleLevel: 'HELPER', requiresApproval: false, maxAutoExecute: 1 };
    case ActionScope.FEW:
      return { minRoleLevel: 'MODERATOR', requiresApproval: false, maxAutoExecute: 10 };
    case ActionScope.MANY:
      return { minRoleLevel: 'ADMIN', requiresApproval: true, maxAutoExecute: 50 };
    case ActionScope.ALL:
      return { minRoleLevel: 'OWNER', requiresApproval: true, maxAutoExecute: 0 };
  }
}

export function validateScope(
  scope: ActionScope,
  userRoleLevel: string,
  guildConfig: { adminRoles: string[]; moderatorRoles: string[]; trustedStaffRoles: string[] }
): { allowed: boolean; reason?: string } {
  const roleHierarchy = ['HELPER', 'MODERATOR', 'ADMIN', 'OWNER'];
  const userLevelIndex = roleHierarchy.indexOf(userRoleLevel);
  
  const requirements = getScopeRequirements(scope);
  const requiredLevelIndex = roleHierarchy.indexOf(requirements.minRoleLevel);

  if (userLevelIndex < requiredLevelIndex) {
    return { 
      allowed: false, 
      reason: `Requires ${requirements.minRoleLevel} role or higher (you have ${userRoleLevel})` 
    };
  }

  return { allowed: true };
}