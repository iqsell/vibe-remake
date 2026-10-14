import { Message, Guild, ChannelType, TextChannel, ThreadChannel } from 'discord.js';
import { logger, createGuildLogger } from '../observability/logger.js';
import { getEnv } from '../config/env.js';
import { prisma } from '../db/client.js';

export interface MessageEligibilityResult {
  eligible: boolean;
  reason?: string;
  mentionType?: 'mention' | 'reply' | 'conversational';
  cleanedContent?: string;
}

export async function checkMessageEligibility(message: Message): Promise<MessageEligibilityResult> {
  const guildLogger = createGuildLogger(message.guildId ?? 'dm');

  // Ignore bot messages
  if (message.author.bot) {
    return { eligible: false, reason: 'Bot message' };
  }

  // Ignore system messages
  if (message.system) {
    return { eligible: false, reason: 'System message' };
  }

  // Must be in a guild for guild-management tools
  if (!message.guild || !message.guildId) {
    return { eligible: false, reason: 'DM not supported for guild tools' };
  }

  // Check if guild config exists and get conversational channels
  const guildConfig = await prisma.guildConfig.findUnique({
    where: { guildId: message.guildId },
    select: { 
      conversationalChannels: true,
      enableConversational: true,
    },
  });

  // Check for direct mention
  const mentionRegex = new RegExp(`^<@!?${message.client.user!.id}>`);
  const isMention = mentionRegex.test(message.content.trim());

  // Check for reply to bot
  const isReply = message.reference?.messageId && 
    await isReplyToBot(message);

  // Check for conversational channel
  const isConversational = guildConfig?.enableConversational && 
    guildConfig?.conversationalChannels?.includes(message.channelId);

  if (!isMention && !isReply && !isConversational) {
    return { eligible: false, reason: 'Not addressed to bot' };
  }

  // Clean the content
  let cleanedContent = message.content;
  let mentionType: 'mention' | 'reply' | 'conversational' = 'conversational';

  if (isMention) {
    cleanedContent = message.content.replace(mentionRegex, '').trim();
    mentionType = 'mention';
  } else if (isReply) {
    mentionType = 'reply';
  }

  // Bound message size
  const MAX_CONTENT_LENGTH = 4000;
  if (cleanedContent.length > MAX_CONTENT_LENGTH) {
    cleanedContent = cleanedContent.slice(0, MAX_CONTENT_LENGTH) + '... [truncated]';
  }

  // Check attachments
  if (message.attachments.size > 0) {
    guildLogger.debug({ 
      target: 'message.policy', 
      attachmentCount: message.attachments.size 
    }, 'Message has attachments');
    // Attachments will be processed separately
  }

  return {
    eligible: true,
    mentionType,
    cleanedContent,
  };
}

async function isReplyToBot(message: Message): Promise<boolean> {
  if (!message.reference?.messageId) return false;
  
  try {
    const referenced = await message.channel.messages.fetch(message.reference.messageId);
    return referenced.author.id === message.client.user!.id;
  } catch {
    return false;
  }
}

export function shouldProcessInConversationalChannel(
  message: Message,
  guildConfig: { enableConversational: boolean; conversationalChannels: string[] } | null
): boolean {
  if (!guildConfig?.enableConversational) return false;
  if (!guildConfig.conversationalChannels?.includes(message.channelId)) return false;
  
  // In conversational channels, process all messages (not just mentions)
  // But still ignore bots and system messages
  return !message.author.bot && !message.system;
}

export async function getGuildConfigForMessage(message: Message) {
  if (!message.guildId) return null;
  
  return prisma.guildConfig.findUnique({
    where: { guildId: message.guildId },
  });
}

export function isGuildManagementRequest(content: string): boolean {
  const managementKeywords = [
    'make this server',
    'channel',
    'category',
    'role',
    'permission',
    'timeout',
    'kick',
    'ban',
    'moderate',
    'ticket',
    'application',
    'investigate',
    'audit',
    'who gave',
    'who added',
    'slowmode',
    'lock',
    'unlock',
    'purge',
    'delete',
    'rename',
    'move',
    'create',
    'setup',
    'configure',
  ];

  const lowerContent = content.toLowerCase();
  return managementKeywords.some(keyword => lowerContent.includes(keyword));
}