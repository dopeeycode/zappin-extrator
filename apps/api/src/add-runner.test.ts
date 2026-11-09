import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampSettings,
  mapAddStatus,
  matchResults,
  runBatch,
  type GroupSocket,
  type ItemResult,
  type ItemStatus,
  type ParticipantResult,
  type RunnerJob,
  type RunnerStore,
} from './add-runner.js';

/* ------------------------------ Fakes ------------------------------ */

interface MemItem {
  id: string;
  jobId: string;
  phone: string;
  status: ItemStatus;
  code: string | null;
  processedAt: Date | null;
}

function memoryStore(job: RunnerJob, phones: string[], previousAttempts: Date[] = []) {
  const state = {
    jobStatus: 'RUNNING' as string,
    reason: null as string | null,
    items: phones.map<MemItem>((phone, i) => ({
      id: `i${String(i).padStart(4, '0')}`,
      jobId: job.id,
      phone,
      status: 'PENDING',
      code: null,
      processedAt: null,
    })),
  };
  // Tentativas de outros jobs nas últimas 24h (contam para o limite diário global)
  const others: MemItem[] = previousAttempts.map((d, i) => ({
    id: `o${i}`,
    jobId: 'other',
    phone: `5511900000${String(i).padStart(3, '0')}`,
    status: 'ADDED',
    code: '200',
    processedAt: d,
  }));

  const store: RunnerStore = {
    async nextRunningJob() {
      return state.jobStatus === 'RUNNING' ? job : null;
    },
    async pendingItems(jobId, limit) {
      return state.items
        .filter((i) => i.jobId === jobId && i.status === 'PENDING')
        .slice(0, limit)
        .map((i) => ({ id: i.id, phone: i.phone }));
    },
    async countPending(jobId) {
      return state.items.filter((i) => i.jobId === jobId && i.status === 'PENDING').length;
    },
    async attemptsSince(since) {
      return [...state.items, ...others].filter(
        (i) => i.processedAt && i.processedAt >= since && i.status !== 'PENDING' && i.status !== 'ALREADY_IN',
      ).length;
    },
    async saveResults(results: ItemResult[], processedAt) {
      for (const r of results) {
        const item = state.items.find((i) => i.id === r.itemId)!;
        Object.assign(item, { status: r.status, code: r.code, processedAt });
      }
    },
    async finishRunning(_jobId, status, reason) {
      if (state.jobStatus === 'RUNNING') {
        state.jobStatus = status;
        state.reason = reason;
      }
    },
    async pauseAllRunning(reason) {
      if (state.jobStatus === 'RUNNING') {
        state.jobStatus = 'PAUSED';
        state.reason = reason;
      }
    },
  };
  return { store, state };
}

/** Socket falso: responde com o código definido por número (padrão 200) e grava as chamadas. */
function fakeSocket(codes: Record<string, string> = {}, opts: { lidReplies?: boolean; throws?: unknown } = {}) {
  const calls: string[][] = [];
  const sock: GroupSocket = {
    async groupParticipantsUpdate(_jid, participants) {
      calls.push(participants);
      if (opts.throws) throw opts.throws;
      return participants.map((jid, idx): ParticipantResult => {
        const phone = jid.split('@')[0];
        return opts.lidReplies
          ? { status: codes[phone] ?? '200', jid: `${9000 + idx}@lid`, content: { attrs: { phone_number: jid } } }
          : { status: codes[phone] ?? '200', jid };
      });
    },
  };
  return { sock, calls };
}

const job = (over: Partial<RunnerJob> = {}): RunnerJob => ({
  id: 'job1',
  groupJid: '120363000000000000@g.us',
  batchSize: 5,
  minDelaySec: 30,
  maxDelaySec: 60,
  dailyLimit: 50,
  ...over,
});

const phones = (n: number) => Array.from({ length: n }, (_, i) => `55119${String(10000000 + i)}`);

/* ------------------------------ Testes ------------------------------ */

test('mapAddStatus: código do WhatsApp → status do item', () => {
  assert.equal(mapAddStatus('200'), 'ADDED');
  assert.equal(mapAddStatus('409'), 'ALREADY_IN');
  assert.equal(mapAddStatus('403'), 'PRIVACY_BLOCKED');
  assert.equal(mapAddStatus('408'), 'RECENTLY_LEFT');
  assert.equal(mapAddStatus(200), 'ADDED');
  for (const other of ['401', '404', '406', '500', '', undefined]) {
    assert.equal(mapAddStatus(other), 'FAILED');
  }
});

test('clampSettings aplica padrões e nunca passa dos limites', () => {
  assert.deepEqual(clampSettings({}), { batchSize: 5, minDelaySec: 60, maxDelaySec: 180, dailyLimit: 50 });
  assert.deepEqual(clampSettings({ batchSize: 50, minDelaySec: 1, maxDelaySec: 2, dailyLimit: 9999 }), {
    batchSize: 10,
    minDelaySec: 30,
    maxDelaySec: 30,
    dailyLimit: 200,
  });
  assert.equal(clampSettings({ batchSize: 0 }).batchSize, 1);
  assert.equal(clampSettings({ batchSize: 'abc' }).batchSize, 5);
  // máximo nunca menor que o mínimo
  const s = clampSettings({ minDelaySec: 120, maxDelaySec: 60 });
  assert.equal(s.maxDelaySec, 120);
});

test('runBatch envia no máximo batchSize por vez', async () => {
  const j = job({ batchSize: 3 });
  const { store, state } = memoryStore(j, phones(8));
  const { sock, calls } = fakeSocket();

  assert.deepEqual(await runBatch(store, sock, j), { kind: 'batch', attempted: 3 });
  assert.deepEqual(await runBatch(store, sock, j), { kind: 'batch', attempted: 3 });
  assert.deepEqual(await runBatch(store, sock, j), { kind: 'done' });
  assert.deepEqual(
    calls.map((c) => c.length),
    [3, 3, 2],
  );
  assert.ok(calls.flat().every((jid) => jid.endsWith('@s.whatsapp.net')));
  assert.equal(state.jobStatus, 'DONE');
  assert.ok(state.items.every((i) => i.status === 'ADDED'));
});

test('runBatch respeita o limite diário (somando outros jobs nas últimas 24h)', async () => {
  const now = new Date('2026-01-10T12:00:00Z');
  const recent = Array.from({ length: 7 }, () => new Date(now.getTime() - 60 * 60 * 1000));
  const old = Array.from({ length: 20 }, () => new Date(now.getTime() - 25 * 60 * 60 * 1000));
  const j = job({ batchSize: 5, dailyLimit: 10 });
  const { store, state } = memoryStore(j, phones(20), [...recent, ...old]);
  const { sock, calls } = fakeSocket();

  // 7 usados nas últimas 24h → só sobram 3 (os de 25h atrás não contam)
  assert.deepEqual(await runBatch(store, sock, j, now), { kind: 'batch', attempted: 3 });
  const second = await runBatch(store, sock, j, now);
  assert.equal(second.kind, 'paused');
  assert.match(state.reason!, /Limite diário/);
  assert.equal(state.jobStatus, 'PAUSED');
  assert.equal(calls.length, 1);
  assert.equal(state.items.filter((i) => i.status === 'PENDING').length, 17);
});

test('runBatch mapeia o resultado de cada pessoa (inclusive resposta com @lid)', async () => {
  const list = phones(5);
  const codes = { [list[1]]: '409', [list[2]]: '403', [list[3]]: '408', [list[4]]: '401' };
  for (const lidReplies of [false, true]) {
    const j = job();
    const { store, state } = memoryStore(j, list);
    const { sock } = fakeSocket(codes, { lidReplies });
    await runBatch(store, sock, j);
    assert.deepEqual(
      state.items.map((i) => i.status),
      ['ADDED', 'ALREADY_IN', 'PRIVACY_BLOCKED', 'RECENTLY_LEFT', 'FAILED'],
    );
    assert.equal(state.jobStatus, 'DONE');
  }
});

test('grupo cheio (500) pausa o job e mantém a pessoa como pendente', async () => {
  const list = phones(4);
  const j = job();
  const { store, state } = memoryStore(j, list);
  const { sock } = fakeSocket({ [list[2]]: '500', [list[3]]: '500' });
  const outcome = await runBatch(store, sock, j);
  assert.equal(outcome.kind, 'paused');
  assert.match(state.reason!, /cheio/);
  assert.deepEqual(
    state.items.map((i) => i.status),
    ['ADDED', 'ADDED', 'PENDING', 'PENDING'],
  );
});

test('perda de admin (erro 401/403 no grupo todo) pausa sem mexer nos itens', async () => {
  for (const code of [401, 403]) {
    const j = job();
    const { store, state } = memoryStore(j, phones(3));
    const err = Object.assign(new Error('not-authorized'), { data: code });
    const { sock } = fakeSocket({}, { throws: err });
    const outcome = await runBatch(store, sock, j);
    assert.equal(outcome.kind, 'paused');
    assert.match(state.reason!, /admin/);
    assert.ok(state.items.every((i) => i.status === 'PENDING'));
  }
});

test('job pausado pelo usuário durante o lote não é sobrescrito', async () => {
  const j = job({ batchSize: 2 });
  const { store, state } = memoryStore(j, phones(2));
  const sock: GroupSocket = {
    async groupParticipantsUpdate(_jid, participants) {
      state.jobStatus = 'PAUSED'; // usuário clicou em pausar enquanto o lote estava no ar
      return participants.map((jid) => ({ status: '200', jid }));
    },
  };
  await runBatch(store, sock, j);
  assert.equal(state.jobStatus, 'PAUSED');
});

test('matchResults: sem resposta para alguém → null (vira FAILED)', () => {
  const items = [
    { id: 'a', phone: '5511900000001' },
    { id: 'b', phone: '5511900000002' },
  ];
  const m = matchResults(items, [{ status: '200', jid: '5511900000002@s.whatsapp.net' }]);
  assert.equal(m.get('a'), null);
  assert.equal(m.get('b')?.status, '200');
});

