import { Message, User, Role, Channel, Guild } from 'discord.js';

export interface ParsedMentions {
  users: User[];
  roles: Role[];
  channels: Channel[];
  rawMentions: {
    users: string[];
    roles: string[];
    channels: string[];
  };
}

export function parseMentions(message: Message): ParsedMentions {
  const users = [...message.mentions.users.values()];
  const roles = [...message.mentions.roles.values()];
  const channels = [...message.mentions.channels.values()];

  const userIds = message.mentions.users.map(u => u.id);
  const roleIds = message.mentions.roles.map(r => r.id);
  const channelIds = message.mentions.channels.map(c => c.id);

  return {
    users,
    roles,
    channels,
    rawMentions: {
      users: userIds,
      roles: roleIds,
      channels: channelIds,
    },
  };
}

export function stripMentions(content: string, clientId: string): string {
  // Strip bot mention
  let cleaned = content.replace(new RegExp(`<@!?${clientId}>`, 'g'), '').trim();
  
  // Strip other user mentions but keep as placeholders
  cleaned = cleaned.replace(/<@!?(\d+)>/g, '@user:$1');
  
  // Strip role mentions
  cleaned = cleaned.replace(/<@&(\d+)>/g, '@role:$1');
  
  // Strip channel mentions
  cleaned = cleaned.replace(/<#(\d+)>/g, '#channel:$1');
  
  return cleaned;
}

export function restoreMentions(
  content: string, 
  guild: Guild,
  userCache: Map<string, User>,
  roleCache: Map<string, Role>,
  channelCache: Map<string, Channel>
): string {
  let restored = content;

  // Restore user mentions
  restored = restored.replace(/@user:(\d+)/g, (match, id) => {
    const user = userCache.get(id) || guild.members.cache.get(id)?.user;
    return user ? `<@${id}>` : match;
  });

  // Restore role mentions
  restored = restored.replace(/@role:(\d+)/g, (match, id) => {
    const role = roleCache.get(id) || guild.roles.cache.get(id);
    return role ? `<@&${id}>` : match;
  });

  // Restore channel mentions
  restored = restored.replace(/#channel:(\d+)/g, (match, id) => {
    const channel = channelCache.get(id) || guild.channels.cache.get(id);
    return channel ? `<#${id}>` : match;
  });

  return restored;
}

export interface ResolvedReferences {
  targetUser?: User;
  targetRole?: Role;
  targetChannel?: Channel;
  targetGuild?: Guild;
  duration?: number; // in milliseconds
  reason?: string;
}

export async function resolveReferences(
  content: string,
  message: Message,
  parsed: ParsedMentions
): Promise<ResolvedReferences> {
  const result: ResolvedReferences = {};
  const lowerContent = content.toLowerCase();

  // Try to resolve target user
  if (parsed.users.length > 0) {
    result.targetUser = parsed.users[0];
  } else if (parsed.rawMentions.users.length > 0) {
    // Try to fetch from mentions
    const userId = parsed.rawMentions.users[0];
    result.targetUser = await message.client.users.fetch(userId).catch(() => undefined);
  }

  // Try to resolve target role
  if (parsed.roles.length > 0) {
    result.targetRole = parsed.roles[0];
  } else if (parsed.rawMentions.roles.length > 0) {
    const roleId = parsed.rawMentions.roles[0];
    result.targetRole = message.guild?.roles.cache.get(roleId);
  }

  // Try to resolve target channel
  if (parsed.channels.length > 0) {
    result.targetChannel = parsed.channels[0];
  } else if (parsed.rawMentions.channels.length > 0) {
    const channelId = parsed.rawMentions.channels[0];
    result.targetChannel = message.guild?.channels.cache.get(channelId);
  }

  // Extract duration from content (e.g., "10m", "1h", "1d")
  const durationMatch = content.match(/(\d+)([smhd])/i);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2].toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    result.duration = value * (multipliers[unit] ?? 0);
  }

  // Extract reason (text after "for" or "because")
  const reasonMatch = content.match(/(?:for|because|reason)\s+(.+)/i);
  if (reasonMatch) {
    result.reason = reasonMatch[1].trim();
  }

  return result;
}

export function findMemberByQuery(guild: Guild, query: string): User | undefined {
  const lowerQuery = query.toLowerCase();
  
  // Try exact ID match
  if (/^\d{17,19}$/.test(query)) {
    return guild.members.cache.get(query)?.user;
  }

  // Try exact username match
  const exactUser = guild.members.cache.find(
    m => m.user.username.toLowerCase() === lowerQuery ||
         m.user.globalName?.toLowerCase() === lowerQuery ||
         m.nickname?.toLowerCase() === lowerQuery
  )?.user;
  
  if (exactUser) return exactUser;

  // Try partial match
  const partialUser = guild.members.cache.find(
    m => m.user.username.toLowerCase().includes(lowerQuery) ||
         m.user.globalName?.toLowerCase().includes(lowerQuery) ||
         m.nickname?.toLowerCase().includes(lowerQuery)
  )?.user;

  return partialUser;
}

export function findRoleByQuery(guild: Guild, query: string): Role | undefined {
  const lowerQuery = query.toLowerCase();
  
  // Try exact ID match
  if (/^\d{17,19}$/.test(query)) {
    return guild.roles.cache.get(query);
  }

  // Try exact name match
  const exactRole = guild.roles.cache.find(
    r => r.name.toLowerCase() === lowerQuery
  );
  
  if (exactRole) return exactRole;

  // Try partial match
  return guild.roles.cache.find(
    r => r.name.toLowerCase().includes(lowerQuery)
  );
}

export function findChannelByQuery(guild: Guild, query: string): Channel | undefined {
  const lowerQuery = query.toLowerCase();
  
  // Try exact ID match
  if (/^\d{17,19}$/.test(query)) {
    return guild.channels.cache.get(query);
  }

  // Try exact name match (with or without #)
  const cleanQuery = query.replace(/^#/, '');
  const exactChannel = guild.channels.cache.find(
    c => c.name.toLowerCase() === cleanQuery.toLowerCase()
  );
  
  if (exactChannel) return exactChannel;

  // Try partial match
  return guild.channels.cache.find(
    c => c.name.toLowerCase().includes(cleanQuery.toLowerCase())
  );
}