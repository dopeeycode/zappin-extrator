import type { FastifyInstance } from 'fastify';
import { prisma } from '../database/prisma.js';
import { whatsapp } from '../whatsapp.js';
import { httpError } from '../http.js';
import { formatPhone } from '../phone.js';
import { ADD_LIMITS, AddRunner, clampSettings, type ItemStatus } from '../add-runner.js';
import { countAttemptsSince, prismaRunnerStore } from '../add-store.js';
import { sendToContact } from './messages.js';

export const addRunner = new AddRunner({
  store: prismaRunnerStore,
  getSocket: () => whatsapp.getSocket(),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_STATUSES: ItemStatus[] = ['PENDING', 'ADDED', 'ALREADY_IN', 'PRIVACY_BLOCKED', 'RECENTLY_LEFT', 'FAILED'];

function emptyCounts(): Record<ItemStatus, number> {
  return Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Record<ItemStatus, number>;
}

async function countsByJob(jobIds: string[]) {
  const rows = await prisma.addJobItem.groupBy({
    by: ['jobId', 'status'],
    where: { jobId: { in: jobIds } },
    _count: { _all: true },
  });
  const out = new Map<string, Record<ItemStatus, number>>();
  for (const id of jobIds) out.set(id, emptyCounts());
  for (const r of rows) out.get(r.jobId)![r.status as ItemStatus] = r._count._all;
  return out;
}

async function dailyUsed() {
  return countAttemptsSince(new Date(Date.now() - DAY_MS));
}

async function requireJob(id: string) {
  const job = await prisma.addJob.findUnique({ where: { id } });
  if (!job) throw httpError(404, 'Job não encontrado.');
  return job;
}

async function jobDetail(id: string) {
  const job = await requireJob(id);
  const items = await prisma.addJobItem.findMany({
    where: { jobId: id },
    orderBy: { id: 'asc' },
    include: { contact: { select: { id: true, phone: true, name: true } } },
  });
  const counts = emptyCounts();
  for (const i of items) counts[i.status as ItemStatus]++;
  return {
    ...job,
    counts,
    total: items.length,
    dailyUsed: await dailyUsed(),
    nextBatchAt: job.status === 'RUNNING' ? (addRunner.nextBatchAt?.toISOString() ?? null) : null,
    items: items.map((i) => ({
      id: i.id,
      status: i.status,
      code: i.code,
      processedAt: i.processedAt,
      inviteSentAt: i.inviteSentAt,
      contact: { ...i.contact, formatted: formatPhone(i.contact.phone) },
    })),
  };
}

export async function addJobsRoutes(app: FastifyInstance) {
  app.get('/api/groups/admin', async () => whatsapp.listAdminGroups());

  app.get('/api/add-jobs/limits', async () => ({ limits: ADD_LIMITS, dailyUsed: await dailyUsed() }));

  app.get('/api/add-jobs', async () => {
    const jobs = await prisma.addJob.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    const counts = await countsByJob(jobs.map((j) => j.id));
    return jobs.map((j) => {
      const c = counts.get(j.id)!;
      return { ...j, counts: c, total: Object.values(c).reduce((a, b) => a + b, 0) };
    });
  });

  app.post<{
    Body: {
      groupJid?: string;
      contactIds?: unknown;
      batchSize?: unknown;
      minDelaySec?: unknown;
      maxDelaySec?: unknown;
      dailyLimit?: unknown;
    };
  }>('/api/add-jobs', async (req) => {
    const body = req.body ?? {};
    const groupJid = body.groupJid;
    if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) throw httpError(400, 'Grupo inválido.');
    const ids = body.contactIds;
    if (!Array.isArray(ids) || !ids.length || !ids.every((i) => typeof i === 'string')) {
      throw httpError(400, 'Selecione ao menos um contato.');
    }
    if (ids.length > 5000) throw httpError(400, 'Máximo de 5000 contatos por job.');
    const settings = clampSettings(body);

    const group = await whatsapp.groupSnapshot(groupJid);
    if (!group.isAdmin) throw httpError(403, 'Você precisa ser admin do grupo para adicionar pessoas.');

    const contacts = await prisma.contact.findMany({
      where: { id: { in: [...new Set(ids as string[])] } },
      select: { id: true, phone: true },
    });
    if (!contacts.length) throw httpError(400, 'Nenhum dos contatos selecionados existe mais.');

    // Quem já está no grupo é marcado como ALREADY_IN sem nem tentar adicionar.
    const now = new Date();
    const pending = contacts.filter((c) => !group.phones.has(c.phone));
    const job = await prisma.addJob.create({
      data: {
        groupJid,
        groupName: group.name,
        status: pending.length ? 'RUNNING' : 'DONE',
        ...settings,
        items: {
          create: contacts.map((c) =>
            group.phones.has(c.phone)
              ? { contactId: c.id, status: 'ALREADY_IN', code: 'pre-check', processedAt: now }
              : { contactId: c.id },
          ),
        },
      },
    });

    addRunner.wake();
    return { id: job.id, total: contacts.length, alreadyIn: contacts.length - pending.length, settings };
  });

  app.get<{ Params: { id: string } }>('/api/add-jobs/:id', async (req) => jobDetail(req.params.id));

  app.post<{ Params: { id: string } }>('/api/add-jobs/:id/pause', async (req) => {
    const job = await requireJob(req.params.id);
    if (job.status !== 'RUNNING') throw httpError(409, 'Só é possível pausar um job em andamento.');
    await prisma.addJob.update({ where: { id: job.id }, data: { status: 'PAUSED', pauseReason: 'Pausado por você.' } });
    return jobDetail(job.id);
  });

  app.post<{ Params: { id: string } }>('/api/add-jobs/:id/resume', async (req) => {
    const job = await requireJob(req.params.id);
    if (job.status !== 'PAUSED') throw httpError(409, 'Só é possível retomar um job pausado.');
    if (!whatsapp.getSocket()) throw httpError(409, 'WhatsApp não está conectado.');
    await prisma.addJob.update({ where: { id: job.id }, data: { status: 'RUNNING', pauseReason: null } });
    addRunner.wake();
    return jobDetail(job.id);
  });

  app.post<{ Params: { id: string } }>('/api/add-jobs/:id/cancel', async (req) => {
    const job = await requireJob(req.params.id);
    if (job.status === 'DONE' || job.status === 'CANCELED') throw httpError(409, 'Este job já terminou.');
    await prisma.addJob.update({ where: { id: job.id }, data: { status: 'CANCELED', pauseReason: null } });
    return jobDetail(job.id);
  });

  /**
   * Envia o link do grupo para UMA pessoa que não pôde ser adicionada por privacidade.
   * Só acontece quando o usuário clica — nunca automaticamente.
   */
  app.post<{ Params: { id: string; itemId: string } }>('/api/add-jobs/:id/items/:itemId/invite', async (req) => {
    const job = await requireJob(req.params.id);
    const item = await prisma.addJobItem.findFirst({ where: { id: req.params.itemId, jobId: job.id } });
    if (!item) throw httpError(404, 'Item não encontrado.');
    if (item.status !== 'PRIVACY_BLOCKED') throw httpError(409, 'Convite só para quem bloqueou ser adicionado.');
    if (item.inviteSentAt) throw httpError(409, 'O convite já foi enviado para esta pessoa.');

    const link = await whatsapp.groupInviteLink(job.groupJid);
    const text =
      `Olá! Tentei te adicionar ao grupo "${job.groupName}", mas sua configuração de privacidade não permite. ` +
      `Se quiser participar, é só entrar por este link: ${link}`;
    await sendToContact(item.contactId, text);
    const updated = await prisma.addJobItem.update({ where: { id: item.id }, data: { inviteSentAt: new Date() } });
    return { id: updated.id, inviteSentAt: updated.inviteSentAt };
  });
}

