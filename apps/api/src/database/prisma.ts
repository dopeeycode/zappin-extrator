import { PrismaClient } from '@prisma/client';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Pasta do schema (apps/api/prisma) — funciona tanto em src/ quanto em dist/. */
const PRISMA_DIR = path.resolve(__dirname, '../../prisma');

/**
 * Resolve o caminho do SQLite. Igual ao Prisma CLI, um `file:` relativo é relativo à pasta
 * do schema (ex.: `file:./dev.db` → apps/api/prisma/dev.db), independente do cwd.
 * Sem DATABASE_URL, usa apps/api/prisma/dev.db.
 */
function getDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
  if (!envUrl.startsWith('file:')) return envUrl;
  const rawPath = envUrl.replace(/^file:/, '');
  const full = path.isAbsolute(rawPath) ? rawPath : path.resolve(PRISMA_DIR, rawPath);
  return `file:${full.replace(/\\/g, '/')}`;
}

export const prisma = new PrismaClient({
  datasources: { db: { url: getDatabaseUrl() } },
  log: ['error'],
});

