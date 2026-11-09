import type { FastifyInstance } from 'fastify';
import { prisma } from '../database/prisma.js';
import { normalizeImport } from '../contacts-import.js';
import { formatPhone } from '../phone.js';
import { httpError } from '../http.js';
import type { Prisma } from '@prisma/client';

interface ImportBody {
  sourceGroup?: { id?: string; name?: string };
  members?: unknown;
}

export async function contactsRoutes(app: FastifyInstance) {
  /** Salva membros extraídos no banco de contatos (upsert por telefone). */
  app.post<{ Body: ImportBody }>('/api/contacts/import', async (req) => {
    const { sourceGroup, members } = req.body ?? {};
    if (!Array.isArray(members)) throw httpError(400, 'Envie "members" como lista.');
    if (members.length > 5000) throw httpError(400, 'Máximo de 5000 contatos por importação.');

    const { valid, skipped } = normalizeImport(members);
    const existing = await prisma.contact.findMany({
      where: { phone: { in: valid.map((c) => c.phone) } },
      select: { phone: true, name: true },
    });
    const existingByPhone = new Map(existing.map((c) => [c.phone, c]));

    let created = 0;
    let updated = 0;
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const c of valid) {
      const prev = existingByPhone.get(c.phone);
      if (!prev) {
        created++;
        ops.push(
          prisma.contact.create({
            data: {
              phone: c.phone,
              name: c.name,
              wasAdmin: c.wasAdmin,
              sourceGroupId: sourceGroup?.id ?? null,
              sourceGroupName: sourceGroup?.name ?? null,
            },
          }),
        );
      } else if (c.name && c.name !== prev.name) {
        // Já existia: só atualiza o nome (origem fica a do primeiro grupo em que foi salvo).
        updated++;
        ops.push(prisma.contact.update({ where: { phone: c.phone }, data: { name: c.name } }));
      } else {
        updated++;
      }
    }
    if (ops.length) await prisma.$transaction(ops);
    return { created, updated, skipped };
  });

  app.get<{ Querystring: { search?: string; sourceGroup?: string } }>('/api/contacts', async (req) => {
    const search = req.query.search?.trim();
    const digits = search?.replace(/\D/g, '');
    const where: Prisma.ContactWhereInput = {};
    if (req.query.sourceGroup) where.sourceGroupId = req.query.sourceGroup;
    if (search) {
      where.OR = [{ name: { contains: search } }, ...(digits ? [{ phone: { contains: digits } }] : [])];
    }

    const [contacts, sources] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: { createdAt: 'desc' } }),
      prisma.contact.groupBy({
        by: ['sourceGroupId', 'sourceGroupName'],
        where: { sourceGroupId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    return {
      items: contacts.map((c) => ({ ...c, formatted: formatPhone(c.phone) })),
      sources: sources
        .map((s) => ({ id: s.sourceGroupId!, name: s.sourceGroupName ?? s.sourceGroupId!, count: s._count._all }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    };
  });

  app.delete<{ Body: { ids?: unknown } }>('/api/contacts', async (req) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.every((i) => typeof i === 'string')) {
      throw httpError(400, 'Envie "ids" como lista de strings.');
    }
    const { count } = await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    return { deleted: count };
  });
}

