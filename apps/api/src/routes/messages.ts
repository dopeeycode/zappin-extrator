import type { FastifyInstance } from 'fastify';
import { prisma } from '../database/prisma.js';
import { whatsapp } from '../whatsapp.js';
import { httpError } from '../http.js';

/** Impede dois envios simultâneos para o mesmo contato (clique duplo, etc.). */
const sending = new Set<string>();

/**
 * Envia texto para UM contato e grava no histórico (MessageLog).
 * Não existe envio em massa de propósito: tudo aqui é individual e disparado pelo usuário.
 */
export async function sendToContact(contactId: string, text: string) {
  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact) throw httpError(404, 'Contato não encontrado.');
  if (sending.has(contactId)) throw httpError(409, 'Já existe um envio em andamento para este contato.');

  sending.add(contactId);
  try {
    await whatsapp.sendText(contact.phone, text);
    return await prisma.messageLog.create({ data: { contactId, text, status: 'SENT' } });
  } catch (err) {
    const status = (err as { statusCode?: number }).statusCode;
    // Erros de validação/conexão (4xx) não chegaram a ser envio: não poluem o histórico.
    if (!status || status >= 500) {
      await prisma.messageLog.create({
        data: { contactId, text, status: 'FAILED', error: (err as Error).message.slice(0, 500) },
      });
    }
    throw err;
  } finally {
    sending.delete(contactId);
  }
}

export async function messagesRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { text?: unknown } }>('/api/contacts/:id/message', async (req) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) throw httpError(400, 'Digite a mensagem.');
    if (text.length > 4000) throw httpError(400, 'Mensagem muito longa (máx. 4000 caracteres).');
    return sendToContact(req.params.id, text);
  });

  app.get<{ Params: { id: string } }>('/api/contacts/:id/messages', async (req) =>
    prisma.messageLog.findMany({
      where: { contactId: req.params.id },
      orderBy: { sentAt: 'desc' },
      take: 100,
    }),
  );
}

