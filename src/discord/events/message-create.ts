import { Message, Events } from 'discord.js';
import { logger, createGuildLogger, createTaskLogger } from '../../observability/logger.js';
import { checkMessageEligibility, getGuildConfigForMessage } from '../message-policy.js';
import { parseMentions, stripMentions } from '../mention-parser.js';
import { getRequestHandler } from '../../agent/request-handler.js';
import { prisma } from '../../db/client.js';
import { isShutdownInProgress } from '../../app/shutdown.js';

export async function handleMessageCreate(message: Message): Promise<void> {
  if (isShutdownInProgress()) {
    logger.debug({ target: 'discord.events.message' }, 'Ignoring message during shutdown');
    return;
  }

  const guildLogger = createGuildLogger(message.guildId ?? 'dm');

  try {
    // Check eligibility
    const eligibility = await checkMessageEligibility(message);
    
    if (!eligibility.eligible) {
      guildLogger.debug({ 
        target: 'discord.events.message', 
        reason: eligibility.reason,
        authorId: message.author.id,
      }, 'Message not eligible for processing');
      return;
    }

    // Check for duplicate processing using message ID
    const existingTask = await prisma.task.findFirst({
      where: { messageId: message.id },
      select: { id: true, status: true },
    });

    if (existingTask) {
      guildLogger.debug({ 
        target: 'discord.events.message', 
        taskId: existingTask.id,
        taskStatus: existingTask.status,
      }, 'Duplicate message detected, skipping');
      return;
    }

    // Parse mentions and clean content
    const parsedMentions = parseMentions(message);
    const cleanedContent = eligibility.cleanedContent ?? stripMentions(message.content, message.client.user!.id);

    guildLogger.info({
      target: 'discord.events.message',
      messageId: message.id,
      authorId: message.author.id,
      channelId: message.channelId,
      mentionType: eligibility.mentionType,
      contentLength: cleanedContent.length,
    }, 'Processing eligible message');

    // Delegate to request handler
    const requestHandler = getRequestHandler();
    if (!requestHandler) {
      guildLogger.error({ target: 'discord.events.message' }, 'Request handler not initialized');
      return;
    }
    await requestHandler.handleMessage(message, cleanedContent, parsedMentions, eligibility.mentionType!);
    
  } catch (error) {
    guildLogger.error({ 
      err: error, 
      target: 'discord.events.message',
      messageId: message.id,
    }, 'Error processing message');
  }
}

export function registerMessageCreateHandler(client: any): void {
  client.on(Events.MessageCreate, handleMessageCreate);
}