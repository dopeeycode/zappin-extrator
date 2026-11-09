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

export interface Contact {
  id: string;
  phone: string;
  formatted: string;
  name: string | null;
  sourceGroupId: string | null;
  sourceGroupName: string | null;
  wasAdmin: boolean;
  tags: string | null;
  createdAt: string;
}

export interface ContactSource {
  id: string;
  name: string;
  count: number;
}

export interface MessageLog {
  id: string;
  contactId: string;
  text: string;
  status: 'SENT' | 'FAILED';
  error: string | null;
  sentAt: string;
}

export type JobStatus = 'RUNNING' | 'PAUSED' | 'DONE' | 'CANCELED';
export type ItemStatus = 'PENDING' | 'ADDED' | 'ALREADY_IN' | 'PRIVACY_BLOCKED' | 'RECENTLY_LEFT' | 'FAILED';

export interface AddSettings {
  batchSize: number;
  minDelaySec: number;
  maxDelaySec: number;
  dailyLimit: number;
}

export interface AddLimits {
  limits: {
    batchSize: { default: number; min: number; max: number };
    minDelaySec: { default: number; min: number };
    maxDelaySec: { default: number; max: number };
    dailyLimit: { default: number; min: number; max: number };
  };
  dailyUsed: number;
}

export interface AddJobSummary extends AddSettings {
  id: string;
  groupJid: string;
  groupName: string;
  status: JobStatus;
  pauseReason: string | null;
  createdAt: string;
  counts: Record<ItemStatus, number>;
  total: number;
}

export interface AddJobItem {
  id: string;
  status: ItemStatus;
  code: string | null;
  processedAt: string | null;
  inviteSentAt: string | null;
  contact: { id: string; phone: string; name: string | null; formatted: string };
}

export interface AddJobDetail extends AddJobSummary {
  dailyUsed: number;
  nextBatchAt: string | null;
  items: AddJobItem[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message ?? `Erro ${res.status}`);
  return body as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  session: () => request<Session>('/api/session'),
  connect: () => request<Session>('/api/session/connect', { method: 'POST' }),
  logout: () => request<Session>('/api/session/logout', { method: 'POST' }),
  groups: () => request<Group[]>('/api/groups'),
  adminGroups: () => request<Group[]>('/api/groups/admin'),
  members: (jid: string, verifyAll: boolean) =>
    request<Extraction>(`/api/groups/${encodeURIComponent(jid)}/members${verifyAll ? '?verify=all' : ''}`),
  exports: () => request<ExportFile[]>('/api/exports'),
  exportUrl: (name: string) => `/api/exports/${encodeURIComponent(name)}`,

  // Contatos
  importContacts: (sourceGroup: { id: string; name: string }, members: Pick<Member, 'phone' | 'name' | 'role'>[]) =>
    request<{ created: number; updated: number; skipped: number }>(
      '/api/contacts/import',
      json('POST', { sourceGroup, members }),
    ),
  contacts: (params: { search?: string; sourceGroup?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set('search', params.search);
    if (params.sourceGroup) qs.set('sourceGroup', params.sourceGroup);
    return request<{ items: Contact[]; sources: ContactSource[] }>(`/api/contacts?${qs}`);
  },
  deleteContacts: (ids: string[]) => request<{ deleted: number }>('/api/contacts', json('DELETE', { ids })),

  // Mensagens individuais
  sendMessage: (contactId: string, text: string) =>
    request<MessageLog>(`/api/contacts/${contactId}/message`, json('POST', { text })),
  messages: (contactId: string) => request<MessageLog[]>(`/api/contacts/${contactId}/messages`),

  // Jobs de adição
  addLimits: () => request<AddLimits>('/api/add-jobs/limits'),
  addJobs: () => request<AddJobSummary[]>('/api/add-jobs'),
  addJob: (id: string) => request<AddJobDetail>(`/api/add-jobs/${id}`),
  createAddJob: (body: AddSettings & { groupJid: string; contactIds: string[] }) =>
    request<{ id: string; total: number; alreadyIn: number; settings: AddSettings }>(
      '/api/add-jobs',
      json('POST', body),
    ),
  jobAction: (id: string, action: 'pause' | 'resume' | 'cancel') =>
    request<AddJobDetail>(`/api/add-jobs/${id}/${action}`, { method: 'POST' }),
  sendInvite: (jobId: string, itemId: string) =>
    request<{ id: string; inviteSentAt: string }>(`/api/add-jobs/${jobId}/items/${itemId}/invite`, {
      method: 'POST',
    }),
};
