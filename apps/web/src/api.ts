export type ConnectionStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED' | 'ERROR';

export interface Session {
  status: ConnectionStatus;
  qrCodeDataUrl: string | null;
  connectedPhone: string | null;
  connectedName: string | null;
  error: string | null;
}

export interface Group {
  id: string;
  name: string;
  size: number;
  isAdmin: boolean;
}

export type PhoneSource = 'self' | 'jid' | 'server' | 'lid-cache';
export type HiddenReason = 'lid-hidden' | 'invalid' | 'conflict' | 'unverified';

export interface Member {
  jid: string;
  lid: string | null;
  phone: string | null;
  formatted: string | null;
  source: PhoneSource | null;
  verified: boolean;
  hiddenReason: HiddenReason | null;
  name: string | null;
  role: 'superadmin' | 'admin' | 'member';
}

export interface Extraction {
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
  warnings: string[];
  members: Member[];
  files: { json: string; csv: string; txt: string };
}

export interface ExportFile {
  name: string;
  size: number;
  createdAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Erro ${res.status}`);
  return body as T;
}

export const api = {
  session: () => request<Session>('/api/session'),
  connect: () => request<Session>('/api/session/connect', { method: 'POST' }),
  logout: () => request<Session>('/api/session/logout', { method: 'POST' }),
  groups: () => request<Group[]>('/api/groups'),
  members: (jid: string, verifyAll: boolean) =>
    request<Extraction>(`/api/groups/${encodeURIComponent(jid)}/members${verifyAll ? '?verify=all' : ''}`),
  exports: () => request<ExportFile[]>('/api/exports'),
  exportUrl: (name: string) => `/api/exports/${encodeURIComponent(name)}`,
};
