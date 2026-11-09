import { pnJidToDigits } from './phone.js';

export interface ImportMemberInput {
  phone?: unknown;
  name?: unknown;
  role?: unknown;
}

export interface NormalizedContact {
  phone: string;
  name: string | null;
  wasAdmin: boolean;
}

/**
 * Valida e deduplica os membros recebidos para importação.
 * Mesma regra estrita da extração: o número só entra se for exatamente um E.164 válido
 * (`pnJidToDigits`). Nada é "corrigido". Repetidos dentro do mesmo envio contam como pulados.
 */
export function normalizeImport(members: unknown): { valid: NormalizedContact[]; skipped: number } {
  if (!Array.isArray(members)) return { valid: [], skipped: 0 };
  const seen = new Set<string>();
  const valid: NormalizedContact[] = [];
  let skipped = 0;

  for (const raw of members as ImportMemberInput[]) {
    const phoneRaw = typeof raw?.phone === 'string' ? raw.phone : null;
    const phone = phoneRaw ? pnJidToDigits(`${phoneRaw}@s.whatsapp.net`) : null;
    if (!phone || phone !== phoneRaw || seen.has(phone)) {
      skipped++;
      continue;
    }
    seen.add(phone);
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : null;
    valid.push({ phone, name, wasAdmin: raw.role === 'admin' || raw.role === 'superadmin' });
  }

  return { valid, skipped };
}

