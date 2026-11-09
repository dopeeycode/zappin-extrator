export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED' | 'ERROR';

export interface SessionDTO {
  status: ConnectionStatus;
  qrCodeDataUrl: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  error: string | null;
}

export interface GroupDTO {
  id: string;
  name: string;
  size: number;
  isAdmin: boolean;
}

/**
 * De onde veio o número:
 * - self: sua própria conta conectada
 * - jid: o ID do participante no grupo já é o telefone (servidor do WhatsApp)
 * - server: atributo phone_number enviado pelo servidor junto do LID
 * - lid-cache: mapeamento local LID→telefone, confirmado no servidor
 */
export type PhoneSource = 'self' | 'jid' | 'server' | 'lid-cache';

/**
 * Por que o número não foi extraído:
 * - lid-hidden: o WhatsApp esconde o número deste membro (privacidade/LID)
 * - invalid: veio um valor que não é telefone válido
 * - conflict: dados contraditórios (ex.: mesmo número em 2 membros)
 * - unverified: o servidor não confirmou o número → descartado
 */
export type HiddenReason = 'lid-hidden' | 'invalid' | 'conflict' | 'unverified';

export interface MemberDTO {
  /** JID original retornado pelo WhatsApp (pode ser @lid ou @s.whatsapp.net) */
  jid: string;
  /** Usuário LID (ID anônimo), quando conhecido */
  lid: string | null;
  /** Somente dígitos, ex: 5511917551613. null = sem número confiável */
  phone: string | null;
  /** Somente exibição, ex: +55 11 91755-1613 */
  formatted: string | null;
  source: PhoneSource | null;
  /** true = confirmado por uma segunda consulta ao servidor do WhatsApp */
  verified: boolean;
  hiddenReason: HiddenReason | null;
  name: string | null;
  role: 'superadmin' | 'admin' | 'member';
}

export interface ExtractionDTO {
  group: { id: string; name: string; description: string | null; size: number; addressingMode: string };
  extractedAt: string;
  totals: {
    members: number;
    withPhone: number;
    hidden: number;
    admins: number;
    verified: number;
    discarded: number;
  };
  /** Avisos de integridade (lista incompleta, verificações que falharam…) */
  warnings: string[];
  members: MemberDTO[];
  files: { json: string; csv: string; txt: string };
}

export interface ExportFileDTO {
  name: string;
  size: number;
  createdAt: string;
}
