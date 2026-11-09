import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fs from 'fs';
import path from 'path';
import { whatsapp, EXPORTS_DIR } from './whatsapp.js';

const PORT = Number(process.env.PORT ?? 3334);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: { level: 'warn' } });

await app.register(cors, { origin: true });

app.setErrorHandler((error: FastifyError, _req, reply) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) app.log.error(error);
  reply.status(status).send({ statusCode: status, message: error.message });
});

app.get('/api/health', async () => ({ status: 'ok' }));

// ---- Sessão WhatsApp ----
app.get('/api/session', async () => whatsapp.getSession());

app.post('/api/session/connect', async () => {
  await whatsapp.connect();
  return whatsapp.getSession();
});

app.post('/api/session/logout', async () => {
  await whatsapp.logout();
  return whatsapp.getSession();
});

// ---- Grupos & membros ----
app.get('/api/groups', async () => whatsapp.listGroups());

app.get<{ Params: { jid: string }; Querystring: { verify?: string } }>(
  '/api/groups/:jid/members',
  async (req) => {
    const jid = decodeURIComponent(req.params.jid);
    if (!jid.endsWith('@g.us')) {
      throw Object.assign(new Error('ID de grupo inválido (deve terminar com @g.us).'), { statusCode: 400 });
    }
    return whatsapp.extractMembers(jid, req.query.verify === 'all');
  },
);

// ---- Arquivos salvos ----
app.get('/api/exports', async () => whatsapp.listExports());

app.get<{ Params: { file: string } }>('/api/exports/:file', async (req, reply) => {
  const name = path.basename(req.params.file);
  const full = path.join(EXPORTS_DIR, name);
  if (!fs.existsSync(full)) return reply.status(404).send({ message: 'Arquivo não encontrado.' });
  reply.header('Content-Disposition', `attachment; filename="${name}"`);
  reply.type(
    name.endsWith('.csv')
      ? 'text/csv; charset=utf-8'
      : name.endsWith('.txt')
        ? 'text/plain; charset=utf-8'
        : 'application/json; charset=utf-8',
  );
  return reply.send(fs.createReadStream(full));
});

const address = await app.listen({ port: PORT, host: HOST });
console.log(`\n🚀 Zapin Extrator API em ${address}`);
console.log(`📁 Arquivos exportados em: ${EXPORTS_DIR}\n`);

// Reconecta automaticamente se já houver sessão salva
if (whatsapp.hasSavedSession()) {
  whatsapp.connect();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await whatsapp.disconnect();
    await app.close();
    process.exit(0);
  });
}
