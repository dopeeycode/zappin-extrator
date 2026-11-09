import { formatPhone, isLidJid, jidUser, pnJidToDigits } from './phone.js';
import type { HiddenReason, MemberDTO, PhoneSource } from './types.js';

/** Formato de participante que o Baileys devolve em groupMetadata(). */
export interface RawParticipant {
  id: string;
  lid?: string;
  phoneNumber?: string;
  name?: string;
  notify?: string;
  admin?: 'admin' | 'superadmin' | null;
}

export interface ResolveContext {
  /** Conta conectada (sock.user) */
  me: { id?: string; lid?: string };
  /** Mapa local do Baileys: lidUser → pnJid */
  lidCache: Map<string, string>;
  /** Nomes conhecidos por JID */
  names: Map<string, string>;
}

/**
 * Resolve o telefone de cada participante usando SOMENTE dados vindos do WhatsApp:
 *   1. self      – é a própria conta conectada (sock.user.id)
 *   2. jid       – o ID do participante já é o telefone (@s.whatsapp.net)
 *   3. server    – grupo em modo LID, mas o servidor mandou o atributo phone_number
 *   4. lid-cache – mapeamento LID→telefone salvo localmente (PRECISA ser confirmado no servidor depois)
 * Qualquer coisa fora disso fica sem número. Números repetidos entre participantes
 * diferentes são descartados (conflito), pois não há como saber qual é o certo.
 */
export function resolveParticipants(participants: RawParticipant[], ctx: ResolveContext): MemberDTO[] {
  const myPn = pnJidToDigits(normalizePn(ctx.me.id));
  const myLid = jidUser(ctx.me.lid);

  const members: MemberDTO[] = participants.map((p) => {
    const lidJid = isLidJid(p.id) ? p.id : isLidJid(p.lid) ? p.lid! : null;
    const lid = jidUser(lidJid);

    let phone: string | null = null;
    let source: PhoneSource | null = null;
    let hiddenReason: HiddenReason | null = null;

    const idPn = pnJidToDigits(p.id);
    const serverPn = pnJidToDigits(p.phoneNumber);
    const cachedPn = lid ? pnJidToDigits(normalizePn(ctx.lidCache.get(lid))) : null;
    const isSelf = (myPn && (idPn === myPn || serverPn === myPn)) || (myLid && lid === myLid);

    if (idPn) {
      phone = idPn;
      source = 'jid';
    } else if (serverPn) {
      phone = serverPn;
      source = 'server';
    } else if (isSelf && myPn) {
      phone = myPn;
      source = 'self';
    } else if (cachedPn) {
      phone = cachedPn;
      source = 'lid-cache';
    } else if (p.phoneNumber || (!isLidJid(p.id) && !idPn)) {
      // Veio algo, mas não é um telefone válido → não arrisca.
      hiddenReason = 'invalid';
    } else {
      hiddenReason = 'lid-hidden';
    }

    // Se o servidor mandou ID de telefone E phone_number divergentes, não confia em nenhum.
    if (idPn && serverPn && idPn !== serverPn) {
      phone = null;
      source = null;
      hiddenReason = 'conflict';
    }

    const name =
      p.name ||
      p.notify ||
      ctx.names.get(p.id) ||
      (lidJid ? ctx.names.get(lidJid) : undefined) ||
      (phone ? ctx.names.get(`${phone}@s.whatsapp.net`) : undefined) ||
      null;

    return {
      jid: p.id,
      lid,
      phone,
      formatted: phone ? formatPhone(phone) : null,
      source,
      verified: source === 'self',
      hiddenReason,
      name,
      role: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member',
    };
  });

  // O mesmo telefone em dois participantes diferentes = algum dado está errado → descarta ambos.
  const byPhone = new Map<string, MemberDTO[]>();
  for (const m of members) {
    if (!m.phone) continue;
    const list = byPhone.get(m.phone) ?? [];
    list.push(m);
    byPhone.set(m.phone, list);
  }
  for (const list of byPhone.values()) {
    if (list.length > 1) for (const m of list) discard(m, 'conflict');
  }

  return members;
}

/** Remove o número de um membro marcando o motivo. */
export function discard(m: MemberDTO, reason: HiddenReason) {
  m.phone = null;
  m.formatted = null;
  m.source = null;
  m.verified = false;
  m.hiddenReason = reason;
}

/** "5511...:3@s.whatsapp.net" → "5511...@s.whatsapp.net" (device não faz parte do número). */
function normalizePn(jid: string | undefined): string | undefined {
  return jid?.replace(/:\d+@s\.whatsapp\.net$/, '@s.whatsapp.net');
}
