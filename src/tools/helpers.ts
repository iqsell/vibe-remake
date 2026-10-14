import { prisma } from '../db/client.js';

type SequencedModel = 'ticket' | 'moderationCase' | 'application' | 'report';

export async function nextSequenceNumber(
  model: SequencedModel,
  guildId: string
): Promise<number> {
  const delegate = (prisma as any)[model];
  const result = await delegate.aggregate({
    where: { guildId },
    _max: { number: true },
  });
  return (result?._max?.number ?? 0) + 1;
}

export async function fetchGuild(client: any, guildId: string): Promise<any> {
  const guild = await client.guilds.fetch(guildId);
  if (!guild) {
    throw new Error('Guild not found');
  }
  return guild;
}

export async function fetchMember(client: any, guildId: string, userId: string): Promise<any> {
  const guild = await fetchGuild(client, guildId);
  const member = await guild.members.fetch(userId);
  if (!member) {
    throw new Error('Member not found');
  }
  return member;
}

export async function fetchTextChannel(client: any, channelId: string): Promise<any> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || typeof channel.isTextBased !== 'function' || !channel.isTextBased()) {
    throw new Error('Channel not found or not a text channel');
  }
  return channel;
}

export function mapOverwrite(overwrite: any): {
  id: string;
  type: number;
  allow: string;
  deny: string;
} {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow?.toString?.() ?? '0',
    deny: overwrite.deny?.toString?.() ?? '0',
  };
}

export function isoSafe(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(value as any).toISOString();
}
