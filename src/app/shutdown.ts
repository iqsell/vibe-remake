import { logger } from '../observability/logger.js';
import { disconnectDatabase } from '../db/client.js';

let isShuttingDown = false;
let shutdownInitiated = false;

type CleanupFn = () => Promise<void> | void;
const cleanupFns: CleanupFn[] = [];

export function registerShutdownCleanup(fn: CleanupFn): void {
  cleanupFns.push(fn);
}

export async function runShutdownCleanups(): Promise<void> {
  for (const fn of cleanupFns.reverse()) {
    try {
      await fn();
    } catch (error) {
      logger.error({ err: error, target: 'shutdown' }, 'Error during shutdown cleanup');
    }
  }
}

export async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownInitiated) {
    logger.warn({ signal, target: 'shutdown' }, 'Shutdown already in progress, forcing exit');
    process.exit(1);
  }

  shutdownInitiated = true;
  isShuttingDown = true;

  logger.info({ signal, target: 'shutdown' }, 'Graceful shutdown initiated');

  // Run registered cleanups (Discord client, job queue, etc.)
  await runShutdownCleanups();

  // Close database connections
  try {
    await disconnectDatabase();
  } catch (error) {
    logger.error({ err: error, target: 'shutdown' }, 'Error during database disconnect');
  }

  logger.info({ target: 'shutdown' }, 'Graceful shutdown complete');
  process.exit(0);
}

export function setupShutdownHandlers(): void {
  const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
  
  for (const signal of signals) {
    process.on(signal, () => gracefulShutdown(signal));
  }

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error, target: 'shutdown' }, 'Uncaught exception');
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason, target: 'shutdown' }, 'Unhandled rejection');
    gracefulShutdown('UNHANDLED_REJECTION');
  });
}

export function isShutdownInProgress(): boolean {
  return isShuttingDown;
}