/**
 * Regras ESTRITAS de número: nunca "conserta" nada. Se o JID não for exatamente um
 * telefone válido, retorna null (é melhor ficar sem número do que ter um número errado).
 */

/** E.164: sem zero à esquerda, 8 a 15 dígitos no total (código do país incluso). */
const E164_DIGITS = /^[1-9]\d{7,14}$/;

/**
 * Converte um JID de telefone ("5511917551613@s.whatsapp.net" ou "5511917551613:12@s.whatsapp.net")
 * em dígitos. Qualquer outro formato (@lid, @hosted, @g.us, caracteres estranhos) → null.
 */
export function pnJidToDigits(jid: string | null | undefined): string | null {
  if (typeof jid !== 'string') return null;
  const match = /^([^@:]+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid.trim());
  if (!match) return null;
  const user = match[1];
  return E164_DIGITS.test(user) ? user : null;
}

/** Usuário de um JID sem device/domínio: "123:4@lid" → "123". */
export function jidUser(jid: string | null | undefined): string | null {
  if (typeof jid !== 'string') return null;
  const user = jid.split('@')[0]?.split(':')[0];
  return user || null;
}

export function isLidJid(jid: string | null | undefined): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/**
 * Apenas para EXIBIÇÃO. O valor canônico é sempre `phone` (dígitos).
 * BR: 55 + DDD + 8/9 dígitos → "+55 11 91755-1613". Outros países: "+<dígitos>".
 */
export function formatPhone(digits: string): string {
  if (/^55[1-9]\d\d{8,9}$/.test(digits)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const split = rest.length - 4;
    return `+55 ${ddd} ${rest.slice(0, split)}-${rest.slice(split)}`;
  }
  return `+${digits}`;
}
