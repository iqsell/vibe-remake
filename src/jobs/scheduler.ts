import { prisma } from '../db/client.js';
import { logger } from '../observability/logger.js';
import { VibeDiscordClient } from '../discord/client.js';
import { PolicyEngine } from '../policy/authorize.js';

const TICK_INTERVAL_MS = 60_000;

let intervalHandle: NodeJS.Timeout | null = null;
let ticking = false;

function computeNext(
  scheduledAt: Date,
  recurring: { frequency?: string; interval?: number; endDate?: string } | null
): Date | null {
  if (!recurring?.frequency) return null;

  const interval = recurring.interval && recurring.interval > 0 ? recurring.interval : 1;
  const next = new Date(scheduledAt);

  if (recurring.frequency === 'DAILY') {
    next.setUTCDate(next.getUTCDate() + interval);
  } else if (recurring.frequency === 'WEEKLY') {
    next.setUTCDate(next.getUTCDate() + 7 * interval);
  } else if (recurring.frequency === 'MONTHLY') {
    next.setUTCMonth(next.getUTCMonth() + interval);
  } else {
    return null;
  }

  if (recurring.endDate) {
    const end = new Date(recurring.endDate);
    if (next > end) return null;
  }

  return next;
}

export async function processDueReminders(discordClient: VibeDiscordClient): Promise<number> {
  const now = new Date();
  const due = await prisma.reminder.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { lte: now } },
    take: 50,
  });

  if (due.length === 0) return 0;

  const client = discordClient.getClient();
  let sent = 0;

  for (const reminder of due) {
    try {
      const user = await client.users.fetch(reminder.userId);
      await user.send(`⏰ Reminder: ${reminder.message}`);
      sent++;

      const next = computeNext(reminder.scheduledAt, (reminder.recurring ?? null) as any);
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: next
          ? { scheduledAt: next, sentAt: now, status: 'SCHEDULED' }
          : { sentAt: now, status: 'SENT' },
      });
    } catch (error) {
      logger.warn(
        { err: error, target: 'jobs.scheduler', reminderId: reminder.id },
        'Failed to deliver reminder; marking as failed'
      );
      await prisma.reminder.update({
        where: { id: reminder.id },
        data: { status: 'FAILED' },
      });
    }
  }

  return sent;
}

async function tick(discordClient: VibeDiscordClient, policyEngine: PolicyEngine): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const sent = await processDueReminders(discordClient);
    if (sent > 0) {
      logger.info({ target: 'jobs.scheduler', sent }, 'Delivered due reminders');
    }
    policyEngine.cleanupExpiredConfirmations();
  } catch (error) {
    logger.error({ err: error, target: 'jobs.scheduler' }, 'Scheduler tick failed');
  } finally {
    ticking = false;
  }
}

export function startJobScheduler(discordClient: VibeDiscordClient, policyEngine: PolicyEngine): void {
  if (intervalHandle) return;

  intervalHandle = setInterval(() => {
    void tick(discordClient, policyEngine);
  }, TICK_INTERVAL_MS);
  intervalHandle.unref?.();

  logger.info({ target: 'jobs.scheduler', intervalMs: TICK_INTERVAL_MS }, 'Job scheduler started');
}

export function stopJobScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info({ target: 'jobs.scheduler' }, 'Job scheduler stopped');
  }
}
