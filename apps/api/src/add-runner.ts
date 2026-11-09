/**
 * Worker que adiciona contatos a um grupo em lotes pequenos e espaçados.
 *
 * Não depende do Prisma nem do Baileys diretamente: recebe um `RunnerStore` (persistência) e
 * um `getSocket()` — assim dá para testar com um banco em memória e um socket falso.
 *
 * Os jobs são processados UM DE CADA VEZ (mesmo que vários estejam RUNNING) e o intervalo
 * entre lotes é global, para o número conectado nunca fazer adições em paralelo.
 */

export type JobStatus = 'RUNNING' | 'PAUSED' | 'DONE' | 'CANCELED';
export type ItemStatus = 'PENDING' | 'ADDED' | 'ALREADY_IN' | 'PRIVACY_BLOCKED' | 'RECENTLY_LEFT' | 'FAILED';

/** Limites de segurança. O usuário pode diminuir, mas nunca passar do máximo. */
export const ADD_LIMITS = {
  batchSize: { default: 5, min: 1, max: 10 },
  minDelaySec: { default: 60, min: 30 },
  maxDelaySec: { default: 180, max: 3600 },
  dailyLimit: { default: 50, min: 1, max: 200 },
} as const;

export interface AddSettings {
  batchSize: number;
  minDelaySec: number;
  maxDelaySec: number;
  dailyLimit: number;
}

function toInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/** Aplica padrões e limites de segurança a configurações vindas do usuário. */
export function clampSettings(input: Partial<Record<keyof AddSettings, unknown>>): AddSettings {
  const L = ADD_LIMITS;
  const batchSize = Math.min(L.batchSize.max, Math.max(L.batchSize.min, toInt(input.batchSize, L.batchSize.default)));
  const minDelaySec = Math.min(
    L.maxDelaySec.max,
    Math.max(L.minDelaySec.min, toInt(input.minDelaySec, L.minDelaySec.default)),
  );
  const maxDelaySec = Math.min(L.maxDelaySec.max, Math.max(minDelaySec, toInt(input.maxDelaySec, L.maxDelaySec.default)));
  const dailyLimit = Math.min(L.dailyLimit.max, Math.max(L.dailyLimit.min, toInt(input.dailyLimit, L.dailyLimit.default)));
  return { batchSize, minDelaySec, maxDelaySec, dailyLimit };
}

/** Código por participante devolvido por `groupParticipantsUpdate` → status do item. */
export function mapAddStatus(code: string | number | undefined): ItemStatus {
  switch (String(code ?? '')) {
    case '200':
      return 'ADDED';
    case '409':
      return 'ALREADY_IN';
    case '403':
      return 'PRIVACY_BLOCKED';
    case '408':
      return 'RECENTLY_LEFT';
    default:
      return 'FAILED';
  }
}

/** Código por participante que indica grupo cheio. */
const GROUP_FULL_CODE = '500';

export interface RunnerJob extends AddSettings {
  id: string;
  groupJid: string;
}

export interface PendingItem {
  id: string;
  phone: string;
}

export interface ItemResult {
  itemId: string;
  status: ItemStatus;
  code: string | null;
}

export interface RunnerStore {
  /** Job RUNNING mais antigo (ou null) */
  nextRunningJob(): Promise<RunnerJob | null>;
  pendingItems(jobId: string, limit: number): Promise<PendingItem[]>;
  countPending(jobId: string): Promise<number>;
  /** Quantas tentativas de adição (qualquer job) foram feitas desde `since` */
  attemptsSince(since: Date): Promise<number>;
  saveResults(results: ItemResult[], processedAt: Date): Promise<void>;
  /** Só altera se o job ainda estiver RUNNING (não sobrescreve pausa/cancelamento do usuário). */
  finishRunning(jobId: string, status: 'PAUSED' | 'DONE', reason: string | null): Promise<void>;
  /** Pausa todos os jobs RUNNING (boot / desconexão). */
  pauseAllRunning(reason: string): Promise<void>;
}

export interface ParticipantResult {
  status: string;
  jid?: string;
  content?: { attrs?: Record<string, string | undefined> };
}

export interface GroupSocket {
  groupParticipantsUpdate(jid: string, participants: string[], action: 'add'): Promise<ParticipantResult[]>;
}

export type BatchOutcome =
  | { kind: 'batch'; attempted: number }
  | { kind: 'done' }
  | { kind: 'paused'; reason: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function digitsOfJid(jid: string | undefined): string | null {
  if (!jid) return null;
  const m = /^(\d+)(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? m[1] : null;
}

/** Extrai o código de erro de um Boom do Baileys (`data` = código do nó de erro). */
function errorCode(err: unknown): number | null {
  const e = err as { data?: unknown; output?: { statusCode?: number } } | null;
  if (typeof e?.data === 'number' && Number.isFinite(e.data)) return e.data;
  return e?.output?.statusCode ?? null;
}

/**
 * Associa cada resultado devolvido pelo WhatsApp ao item enviado. Primeiro pelo número
 * (jid ou atributo phone_number — em grupos LID a resposta pode vir com o @lid); o que
 * sobrar é associado pela ordem, só se as quantidades baterem. Sem resposta → FAILED.
 */
export function matchResults(items: PendingItem[], results: ParticipantResult[]): Map<string, ParticipantResult | null> {
  const byPhone = new Map(items.map((i) => [i.phone, i]));
  const out = new Map<string, ParticipantResult | null>();
  const leftovers: ParticipantResult[] = [];

  for (const r of results) {
    const phone = digitsOfJid(r.jid) ?? digitsOfJid(r.content?.attrs?.phone_number);
    const item = phone ? byPhone.get(phone) : undefined;
    if (item && !out.has(item.id)) out.set(item.id, r);
    else leftovers.push(r);
  }

  const unmatched = items.filter((i) => !out.has(i.id));
  if (leftovers.length && leftovers.length === unmatched.length) {
    unmatched.forEach((item, idx) => out.set(item.id, leftovers[idx]));
  }
  for (const item of items) if (!out.has(item.id)) out.set(item.id, null);
  return out;
}

/**
 * Processa UM lote do job: respeita o limite diário (soma de todos os jobs nas últimas 24h),
 * chama `groupParticipantsUpdate` e grava o resultado de cada item.
 */
export async function runBatch(
  store: RunnerStore,
  sock: GroupSocket,
  job: RunnerJob,
  now: Date = new Date(),
): Promise<BatchOutcome> {
  const used = await store.attemptsSince(new Date(now.getTime() - DAY_MS));
  const remaining = job.dailyLimit - used;
  if (remaining <= 0) {
    const reason = `Limite diário atingido (${used}/${job.dailyLimit} nas últimas 24h). Retome mais tarde.`;
    await store.finishRunning(job.id, 'PAUSED', reason);
    return { kind: 'paused', reason };
  }

  const items = await store.pendingItems(job.id, Math.min(job.batchSize, remaining));
  if (!items.length) {
    await store.finishRunning(job.id, 'DONE', null);
    return { kind: 'done' };
  }

  let results: ParticipantResult[];
  try {
    results = await sock.groupParticipantsUpdate(
      job.groupJid,
      items.map((i) => `${i.phone}@s.whatsapp.net`),
      'add',
    );
  } catch (err) {
    const code = errorCode(err);
    const reason =
      code === 401 || code === 403
        ? 'Você não é mais admin deste grupo (ou perdeu permissão para adicionar).'
        : `Erro do WhatsApp ao adicionar${code ? ` (código ${code})` : ''}: ${(err as Error)?.message ?? err}`;
    await store.finishRunning(job.id, 'PAUSED', reason);
    return { kind: 'paused', reason };
  }

  const matched = matchResults(items, results);
  const saved: ItemResult[] = [];
  let groupFull = false;
  for (const item of items) {
    const r = matched.get(item.id);
    const code = r ? String(r.status) : null;
    if (code === GROUP_FULL_CODE) {
      groupFull = true; // continua PENDING: pode ser retomado se abrir vaga
      continue;
    }
    saved.push({ itemId: item.id, status: r ? mapAddStatus(code!) : 'FAILED', code: code ?? 'sem-resposta' });
  }
  await store.saveResults(saved, now);

  if (groupFull) {
    const reason = 'O grupo está cheio. Libere vagas e retome.';
    await store.finishRunning(job.id, 'PAUSED', reason);
    return { kind: 'paused', reason };
  }

  if ((await store.countPending(job.id)) === 0) {
    await store.finishRunning(job.id, 'DONE', null);
    return { kind: 'done' };
  }
  return { kind: 'batch', attempted: items.length };
}

export interface AddRunnerDeps {
  store: RunnerStore;
  getSocket: () => GroupSocket | null;
  random?: () => number;
  log?: (msg: string) => void;
}

export class AddRunner {
  private running = false;
  private wakeUp: (() => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** Próximo momento em que um lote pode ser enviado (intervalo global entre lotes). */
  private nextAllowedAt = 0;

  constructor(private deps: AddRunnerDeps) {}

  /** Momento previsto do próximo lote (para mostrar na tela). */
  get nextBatchAt(): Date | null {
    return this.nextAllowedAt > Date.now() ? new Date(this.nextAllowedAt) : null;
  }

  /** No boot: o que estava RUNNING volta como PAUSED (usuário clica em retomar). */
  async recoverOnBoot() {
    await this.deps.store.pauseAllRunning('A API foi reiniciada. Clique em retomar para continuar.');
  }

  start() {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop() {
    this.running = false;
    this.wake();
  }

  /** Acorda o loop (novo job / retomada). Não fura o intervalo entre lotes. */
  wake() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.wakeUp;
    this.wakeUp = null;
    w?.();
  }

  private wait(ms: number | null) {
    return new Promise<void>((resolve) => {
      this.wakeUp = resolve;
      if (ms !== null) this.timer = setTimeout(() => this.wake(), ms);
    });
  }

  private async loop() {
    const { store, getSocket } = this.deps;
    const log = this.deps.log ?? ((m: string) => console.log(m));
    const random = this.deps.random ?? Math.random;

    while (this.running) {
      try {
        const job = await store.nextRunningJob();
        if (!job) {
          await this.wait(null);
          continue;
        }

        const waitMs = this.nextAllowedAt - Date.now();
        if (waitMs > 0) {
          await this.wait(waitMs);
          continue; // relê o job: pode ter sido pausado/cancelado durante a espera
        }

        const sock = getSocket();
        if (!sock) {
          await store.pauseAllRunning('WhatsApp desconectado. Reconecte e clique em retomar.');
          log('⏸️  Jobs de adição pausados: WhatsApp desconectado.');
          continue;
        }

        const outcome = await runBatch(store, sock, job);
        if (outcome.kind === 'batch') {
          const delaySec = job.minDelaySec + random() * (job.maxDelaySec - job.minDelaySec);
          this.nextAllowedAt = Date.now() + Math.round(delaySec * 1000);
          log(`➕ Job ${job.id}: lote de ${outcome.attempted} enviado. Próximo em ${Math.round(delaySec)}s.`);
        } else if (outcome.kind === 'paused') {
          log(`⏸️  Job ${job.id} pausado: ${outcome.reason}`);
        } else {
          log(`✅ Job ${job.id} concluído.`);
        }
      } catch (err) {
        log(`❌ Erro no worker de adição: ${(err as Error).message}`);
        await this.wait(10_000);
      }
    }
  }
}

