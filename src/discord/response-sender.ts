import { Message, TextChannel, ThreadChannel, EmbedBuilder, APIEmbed } from 'discord.js';
import { logger, createGuildLogger } from '../observability/logger.js';

const DISCORD_MESSAGE_LIMIT = 2000;
const DISCORD_EMBED_DESCRIPTION_LIMIT = 4096;
const DISCORD_EMBED_FIELD_VALUE_LIMIT = 1024;
const DISCORD_EMBED_FIELDS_LIMIT = 25;

export interface ResponseOptions {
  reply?: boolean;
  embed?: boolean;
  codeBlock?: boolean;
  language?: string;
}

export async function sendResponse(
  message: Message,
  content: string,
  options: ResponseOptions = {}
): Promise<Message | Message[]> {
  const guildLogger = createGuildLogger(message.guildId ?? 'dm');
  const channel = message.channel;

  if (!channel.isTextBased()) {
    throw new Error('Cannot send response to non-text channel');
  }

  // Split content if too long
  const chunks = chunkContent(content, options);
  
  if (chunks.length === 1) {
    return sendSingleResponse(message, chunks[0], options);
  }

  // Send multiple chunks
  const sentMessages: Message[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    
    const sent = await sendSingleResponse(message, chunk, {
      ...options,
      reply: isFirst ? options.reply : false,
    });
    
    if (Array.isArray(sent)) {
      sentMessages.push(...sent);
    } else {
      sentMessages.push(sent);
    }

    // Small delay between chunks to avoid rate limits
    if (!isLast) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return sentMessages;
}

async function sendSingleResponse(
  message: Message,
  content: string,
  options: ResponseOptions
): Promise<Message> {
  const channel = message.channel as TextChannel | ThreadChannel;
  const { reply = true, embed = false, codeBlock = false, language } = options;

  let finalContent = content;
  
  if (codeBlock && language) {
    finalContent = `\`\`\`${language}\n${content}\n\`\`\``;
  } else if (codeBlock) {
    finalContent = `\`\`\n${content}\n\`\`\``;
  }

  try {
    if (reply) {
      return await message.reply({ content: finalContent });
    } else {
      return await channel.send({ content: finalContent });
    }
  } catch (error) {
    logger.error({ err: error, target: 'discord.response' }, 'Failed to send response');
    throw error;
  }
}

export async function sendEmbedResponse(
  message: Message,
  embed: EmbedBuilder | APIEmbed,
  options: { reply?: boolean } = {}
): Promise<Message> {
  const channel = message.channel as TextChannel | ThreadChannel;
  const { reply = true } = options;

  try {
    const embedBuilder = embed instanceof EmbedBuilder ? embed : new EmbedBuilder(embed);
    
    if (reply) {
      return await message.reply({ embeds: [embedBuilder] });
    } else {
      return await channel.send({ embeds: [embedBuilder] });
    }
  } catch (error) {
    logger.error({ err: error, target: 'discord.response' }, 'Failed to send embed response');
    throw error;
  }
}

export async function sendPaginatedResponse(
  message: Message,
  pages: (string | EmbedBuilder)[],
  options: { reply?: boolean; timeout?: number } = {}
): Promise<Message> {
  const { reply = true, timeout = 120000 } = options;
  const channel = message.channel as TextChannel | ThreadChannel;

  if (pages.length === 0) {
    throw new Error('No pages to send');
  }

  if (pages.length === 1) {
    const page = pages[0];
    if (typeof page === 'string') {
      return sendResponse(message, page, { reply }) as Promise<Message>;
    } else {
      return sendEmbedResponse(message, page, { reply });
    }
  }

  // Create paginated embed
  const embeds = pages.map((page, index) => {
    const embed = page instanceof EmbedBuilder 
      ? page 
      : new EmbedBuilder().setDescription(page);
    
    embed.setFooter({ text: `Page ${index + 1} of ${pages.length}` });
    return embed;
  });

  // For now, send as multiple messages (pagination with reactions would need collectors)
  const sent: Message[] = [];
  for (let i = 0; i < embeds.length; i++) {
    const isFirst = i === 0;
    const sentMsg = await sendEmbedResponse(message, embeds[i], { reply: isFirst ? reply : false });
    sent.push(sentMsg);
    
    if (i < embeds.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return sent[0];
}

function chunkContent(content: string, options: ResponseOptions): string[] {
  const { codeBlock = false, language } = options;
  
  if (!codeBlock) {
    return simpleChunk(content, DISCORD_MESSAGE_LIMIT);
  }

  // For code blocks, we need to preserve the code block structure
  const prefix = language ? `\`\`\`${language}\n` : '\`\`\`\n';
  const suffix = '\n\`\`\`';
  const overhead = prefix.length + suffix.length;
  const maxContentLength = DISCORD_MESSAGE_LIMIT - overhead;

  if (content.length <= maxContentLength) {
    return [content];
  }

  // Split by lines to avoid breaking in the middle of a line
  const lines = content.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    const lineWithNewline = line + '\n';
    
    if (currentChunk.length + lineWithNewline.length > maxContentLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      
      // If a single line is too long, hard split it
      if (lineWithNewline.length > maxContentLength) {
        const hardChunks = simpleChunk(lineWithNewline, maxContentLength);
        chunks.push(...hardChunks.slice(0, -1));
        currentChunk = hardChunks[hardChunks.length - 1];
      } else {
        currentChunk = lineWithNewline;
      }
    } else {
      currentChunk += lineWithNewline;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function simpleChunk(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    let end = start + maxLength;
    
    if (end >= content.length) {
      chunks.push(content.slice(start));
      break;
    }

    // Try to break at a newline or space
    let breakPoint = content.lastIndexOf('\n', end);
    if (breakPoint <= start) {
      breakPoint = content.lastIndexOf(' ', end);
    }
    if (breakPoint <= start) {
      breakPoint = end;
    }

    chunks.push(content.slice(start, breakPoint));
    start = breakPoint;
  }

  return chunks;
}

export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x00FF00)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFF0000)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function createWarningEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xFFAA00)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function createInfoEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function createProgressEmbed(title: string, description: string, step: number, total: number): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle(title)
    .setDescription(description)
    .addFields({ name: 'Progress', value: `${step}/${total}`, inline: true })
    .setTimestamp();
}