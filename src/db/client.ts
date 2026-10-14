import { PrismaClient } from '@prisma/client';
import { logger } from '../observability/logger.js';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

prisma.$on('query' as never, (e: any) => {
  logger.debug({
    query: e.query,
    params: e.params,
    duration: e.duration,
    target: 'db.query',
  });
});

prisma.$on('error' as never, (e: any) => {
  logger.error({ err: e, target: 'db.error' });
});

prisma.$on('warn' as never, (e: any) => {
  logger.warn({ message: e.message, target: 'db.warn' });
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error({ err: error, target: 'db.connect' }, 'Failed to connect to database');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error({ err: error, target: 'db.disconnect' }, 'Error disconnecting from database');
    throw error;
  }
}

export async function healthCheckDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

export { PrismaClient } from '@prisma/client';