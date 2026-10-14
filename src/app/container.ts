import { logger, createChildLogger } from '../observability/logger.js';
import { prisma } from '../db/client.js';
import { getEnv } from '../config/env.js';

export interface Container {
  logger: ReturnType<typeof createChildLogger>;
  prisma: typeof prisma;
  env: ReturnType<typeof getEnv>;
}

let containerInstance: Container | null = null;

export function createContainer(): Container {
  if (containerInstance) {
    return containerInstance;
  }

  const env = getEnv();
  
  const container: Container = {
    logger: createChildLogger({ service: 'vibe' }),
    prisma,
    env,
  };

  containerInstance = container;
  return container;
}

export function getContainer(): Container {
  if (!containerInstance) {
    return createContainer();
  }
  return containerInstance;
}

export function resetContainer(): void {
  containerInstance = null;
}