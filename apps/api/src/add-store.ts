import { prisma } from './database/prisma.js';
import type { RunnerStore } from './add-runner.js';

/** Status que contam como tentativa real de adição (para o limite diário). */
export const ATTEMPT_STATUSES = ['ADDED', 'PRIVACY_BLOCKED', 'RECENTLY_LEFT', 'FAILED'];

export function countAttemptsSince(since: Date) {
  return prisma.addJobItem.count({
    where: { status: { in: ATTEMPT_STATUSES }, processedAt: { gte: since } },
  });
}

/** Implementação do RunnerStore com Prisma/SQLite. */
export const prismaRunnerStore: RunnerStore = {
  async nextRunningJob() {
    return prisma.addJob.findFirst({
      where: { status: 'RUNNING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        groupJid: true,
        batchSize: true,
        minDelaySec: true,
        maxDelaySec: true,
        dailyLimit: true,
      },
    });
  },

  async pendingItems(jobId, limit) {
    const rows = await prisma.addJobItem.findMany({
      where: { jobId, status: 'PENDING' },
      take: limit,
      orderBy: { id: 'asc' },
      select: { id: true, contact: { select: { phone: true } } },
    });
    return rows.map((r) => ({ id: r.id, phone: r.contact.phone }));
  },

  countPending(jobId) {
    return prisma.addJobItem.count({ where: { jobId, status: 'PENDING' } });
  },

  attemptsSince: countAttemptsSince,

  async saveResults(results, processedAt) {
    await prisma.$transaction(
      results.map((r) =>
        prisma.addJobItem.update({
          where: { id: r.itemId },
          data: { status: r.status, code: r.code, processedAt },
        }),
      ),
    );
  },

  async finishRunning(jobId, status, reason) {
    await prisma.addJob.updateMany({
      where: { id: jobId, status: 'RUNNING' },
      data: { status, pauseReason: reason },
    });
  },

  async pauseAllRunning(reason) {
    await prisma.addJob.updateMany({ where: { status: 'RUNNING' }, data: { status: 'PAUSED', pauseReason: reason } });
  },
};

