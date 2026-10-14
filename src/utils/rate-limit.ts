import { prisma } from '../db/client.js';
import { getEnv } from '../config/env.js';
import { logger } from '../observability/logger.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

const WINDOW_MS = 60 * 1000; // 1 minute window

export async function checkRateLimit(
  guildId: string,
  userId: string
): Promise<RateLimitResult> {
  const env = getEnv();
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    // Check global rate limit
    const globalBucket = await getOrCreateBucket('GLOBAL', 'global', windowStart);
    if (globalBucket.count >= env.RATE_LIMIT_GLOBAL) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: globalBucket.windowEnd,
        retryAfter: globalBucket.windowEnd - now,
      };
    }

    // Check guild rate limit
    const guildBucket = await getOrCreateBucket('GUILD', guildId, windowStart);
    if (guildBucket.count >= env.RATE_LIMIT_PER_GUILD) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: guildBucket.windowEnd,
        retryAfter: guildBucket.windowEnd - now,
      };
    }

    // Check user rate limit
    const userBucket = await getOrCreateBucket('USER', userId, windowStart);
    if (userBucket.count >= env.RATE_LIMIT_PER_USER) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: userBucket.windowEnd,
        retryAfter: userBucket.windowEnd - now,
      };
    }

    // Check user-guild rate limit
    const userGuildBucket = await getOrCreateBucket('USER_GUILD', `${userId}:${guildId}`, windowStart);
    if (userGuildBucket.count >= env.RATE_LIMIT_PER_USER) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: userGuildBucket.windowEnd,
        retryAfter: userGuildBucket.windowEnd - now,
      };
    }

    return {
      allowed: true,
      remaining: Math.min(
        env.RATE_LIMIT_GLOBAL - globalBucket.count,
        env.RATE_LIMIT_PER_GUILD - guildBucket.count,
        env.RATE_LIMIT_PER_USER - userBucket.count,
        env.RATE_LIMIT_PER_USER - userGuildBucket.count
      ),
      resetAt: now + WINDOW_MS,
    };
  } catch (error) {
    logger.error({ err: error, target: 'utils.rate-limit' }, 'Rate limit check failed');
    // Fail open - allow request if rate limiting fails
    return { allowed: true, remaining: 1, resetAt: now + WINDOW_MS };
  }
}

export async function incrementRateLimit(
  guildId: string,
  userId: string
): Promise<void> {
  const env = getEnv();
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    await Promise.all([
      incrementBucket('GLOBAL', 'global', windowStart, env.RATE_LIMIT_GLOBAL),
      incrementBucket('GUILD', guildId, windowStart, env.RATE_LIMIT_PER_GUILD),
      incrementBucket('USER', userId, windowStart, env.RATE_LIMIT_PER_USER),
      incrementBucket('USER_GUILD', `${userId}:${guildId}`, windowStart, env.RATE_LIMIT_PER_USER),
    ]);
  } catch (error) {
    logger.error({ err: error, target: 'utils.rate-limit' }, 'Failed to increment rate limit');
  }
}

async function getOrCreateBucket(
  scope: 'GLOBAL' | 'GUILD' | 'USER' | 'USER_GUILD',
  identifier: string,
  windowStart: number
): Promise<{ count: number; windowEnd: number }> {
  const bucket = await prisma.rateLimitBucket.findUnique({
    where: { 
      scope_identifier_windowStart: { 
        scope: scope as any, 
        identifier, 
        windowStart: new Date(windowStart) 
      } 
    },
  });

  if (bucket) {
    return { count: bucket.count, windowEnd: bucket.windowEnd.getTime() };
  }

  const windowEnd = windowStart + WINDOW_MS;
  const newBucket = await prisma.rateLimitBucket.create({
    data: {
      scope: scope as any,
      identifier,
      count: 0,
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
    },
  });

  return { count: 0, windowEnd: newBucket.windowEnd.getTime() };
}

async function incrementBucket(
  scope: 'GLOBAL' | 'GUILD' | 'USER' | 'USER_GUILD',
  identifier: string,
  windowStart: number,
  limit: number
): Promise<void> {
  const windowEnd = windowStart + WINDOW_MS;
  
  await prisma.rateLimitBucket.upsert({
    where: { 
      scope_identifier_windowStart: { 
        scope: scope as any, 
        identifier, 
        windowStart: new Date(windowStart) 
      } 
    },
    update: { count: { increment: 1 } },
    create: {
      scope: scope as any,
      identifier,
      count: 1,
      windowStart: new Date(windowStart),
      windowEnd: new Date(windowEnd),
    },
  });
}

export async function cleanupOldBuckets(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * WINDOW_MS);
  
  await prisma.rateLimitBucket.deleteMany({
    where: { windowStart: { lt: cutoff } },
  });
}

export async function resetRateLimit(
  scope: 'GLOBAL' | 'GUILD' | 'USER' | 'USER_GUILD',
  identifier: string
): Promise<void> {
  await prisma.rateLimitBucket.deleteMany({
    where: { scope: scope as any, identifier },
  });
}