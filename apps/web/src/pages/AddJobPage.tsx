import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { Ban, Clock, Loader2, Pause, Play, RefreshCw, Send, UserPlus } from 'lucide-react';
import { api, type AddJobDetail, type AddJobSummary, type ItemStatus, type JobStatus } from '../api';
import { Button, Card } from '../components/ui';
import { useToast } from '../components/Toast';

const POLL_MS = 3000;

const JOB_LABEL: Record<JobStatus, { text: string; cls: string }> = {
  RUNNING: { text: 'Em andamento', cls: 'bg-brand-cyan/10 text-brand-cyan' },
  PAUSED: { text: 'Pausado', cls: 'bg-brand-warning/10 text-brand-warning' },
  DONE: { text: 'Concluído', cls: 'bg-brand-success/10 text-brand-success' },
  CANCELED: { text: 'Cancelado', cls: 'bg-dark-hover text-content-muted' },
};

const ITEM_LABEL: Record<ItemStatus, { text: string; cls: string; bar: string }> = {
  ADDED: { text: 'Adicionados', cls: 'text-brand-success', bar: 'bg-brand-success' },
  ALREADY_IN: { text: 'Já estavam', cls: 'text-brand-cyan', bar: 'bg-brand-cyan' },
  PRIVACY_BLOCKED: { text: 'Bloqueado (privacidade)', cls: 'text-brand-warning', bar: 'bg-brand-warning' },
  RECENTLY_LEFT: { text: 'Saiu recentemente', cls: 'text-orange-400', bar: 'bg-orange-400' },
  FAILED: { text: 'Falhou', cls: 'text-brand-error', bar: 'bg-brand-error' },
  PENDING: { text: 'Pendentes', cls: 'text-content-secondary', bar: 'bg-dark-hover' },
};

const ITEM_ORDER: ItemStatus[] = ['ADDED', 'ALREADY_IN', 'PRIVACY_BLOCKED', 'RECENTLY_LEFT', 'FAILED', 'PENDING'];

function ProgressBar({ counts, total }: { counts: Record<ItemStatus, number>; total: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-dark-hover">
      {ITEM_ORDER.filter((s) => s !== 'PENDING').map((s) =>
        counts[s] ? (
          <div key={s} className={ITEM_LABEL[s].bar} style={{ width: `${(counts[s] / Math.max(1, total)) * 100}%` }} />
        ) : null,
      )}
    </div>
  );
}

function useCountdown(target: string | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.round((new Date(target).getTime() - now) / 1000));
}

function JobDetail({ jobId, active, onChanged }: { jobId: string; active: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [job, setJob] = useState<AddJobDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const countdown = useCountdown(job?.nextBatchAt ?? null);

  const load = useCallback(() => api.addJob(jobId).then(setJob).catch((e) => toast((e as Error).message, 'error')), [
    jobId,
    toast,
  ]);

  useEffect(() => {
    setJob(null);
    load();
  }, [load]);

  // Atualiza a cada 3 s enquanto a aba estiver aberta e o job não tiver terminado.
  useEffect(() => {
    if (!active || job?.status === 'DONE' || job?.status === 'CANCELED') return;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, job?.status, load]);

  const action = async (a: 'pause' | 'resume' | 'cancel') => {
    if (a === 'cancel' && !confirm('Cancelar este job? Os pendentes não serão adicionados.')) return;
    setBusy(a);
    try {
      setJob(await api.jobAction(jobId, a));
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const invite = async (itemId: string) => {
    setBusy(itemId);
    try {
      await api.sendInvite(jobId, itemId);
      toast('Convite enviado.', 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!job) {
    return (
      <Card className="flex flex-1 items-center justify-center text-content-muted">
        <Loader2 className="animate-spin" />
      </Card>
    );
  }

  const processed = job.total - job.counts.PENDING;
  const blocked = job.items.filter((i) => i.status === 'PRIVACY_BLOCKED');
  const others = job.items.filter((i) => i.status !== 'PRIVACY_BLOCKED' && i.status !== 'PENDING');

  return (
    <Card className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-4 border-b border-dark-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{job.groupName}</h2>
            <p className="text-xs text-content-muted">
              Criado em {new Date(job.createdAt).toLocaleString('pt-BR')} · lotes de {job.batchSize} ·{' '}
              {job.minDelaySec}–{job.maxDelaySec}s entre lotes · limite {job.dailyLimit}/24h (usado hoje: {job.dailyUsed})
            </p>
          </div>
          <div className="flex gap-2">
            {job.status === 'RUNNING' && (
              <Button onClick={() => action('pause')} disabled={!!busy}>
                <Pause size={16} /> Pausar
              </Button>
            )}
            {job.status === 'PAUSED' && (
              <Button variant="primary" onClick={() => action('resume')} disabled={!!busy}>
                <Play size={16} /> Retomar
              </Button>
            )}
            {(job.status === 'RUNNING' || job.status === 'PAUSED') && (
              <Button variant="danger" onClick={() => action('cancel')} disabled={!!busy}>
                <Ban size={16} /> Cancelar
              </Button>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className={clsx('rounded px-2 py-0.5 text-xs', JOB_LABEL[job.status].cls)}>
              {JOB_LABEL[job.status].text}
            </span>
            <span className="tabular-nums text-content-secondary">
              {processed}/{job.total}
            </span>
          </div>
          <ProgressBar counts={job.counts} total={job.total} />
          {job.status === 'RUNNING' && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-content-secondary">
              <Clock size={12} />
              {countdown !== null && countdown > 0 ? `Próximo lote em ${countdown}s` : 'Enviando próximo lote…'}
            </p>
          )}
          {job.status === 'PAUSED' && job.pauseReason && (
            <p className="mt-2 rounded-lg border border-brand-warning/30 bg-brand-warning/10 p-2 text-xs text-brand-warning">
              {job.pauseReason}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {ITEM_ORDER.map((s) => (
            <div key={s} className="rounded-lg border border-dark-border bg-dark-bg p-2.5">
              <div className={clsx('text-[11px]', ITEM_LABEL[s].cls)}>{ITEM_LABEL[s].text}</div>
              <div className="text-lg font-semibold tabular-nums">{job.counts[s]}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {blocked.length > 0 && (
          <section className="border-b border-dark-border p-4">
            <h3 className="text-sm font-semibold text-brand-warning">Não permitem ser adicionados ({blocked.length})</h3>
            <p className="mb-2 text-xs text-content-muted">
              O WhatsApp não deixa adicionar estas pessoas. Você pode mandar o link do grupo — uma por vez, só quando
              clicar.
            </p>
            <ul className="space-y-1">
              {blocked.map((i) => (
                <li key={i.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-dark-hover/40">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">{i.contact.formatted}</div>
                    <div className="truncate text-xs text-content-muted">{i.contact.name ?? 'Sem nome'}</div>
                  </div>
                  {i.inviteSentAt ? (
                    <span className="text-xs text-brand-success">
                      Convite enviado {new Date(i.inviteSentAt).toLocaleString('pt-BR')}
                    </span>
                  ) : (
                    <Button onClick={() => invite(i.id)} disabled={!!busy}>
                      {busy === i.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Enviar convite
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {others.length > 0 && (
          <section className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Processados</h3>
            <ul className="space-y-0.5">
              {others.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-2 py-1 text-sm">
                  <span className="flex-1 truncate font-mono">{i.contact.formatted}</span>
                  <span className="hidden flex-1 truncate text-xs text-content-muted sm:block">{i.contact.name}</span>
                  <span className={clsx('text-xs', ITEM_LABEL[i.status].cls)} title={i.code ?? undefined}>
                    {ITEM_LABEL[i.status].text}
                    {i.status === 'FAILED' && i.code ? ` (${i.code})` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!blocked.length && !others.length && (
          <p className="p-8 text-center text-sm text-content-muted">Nenhum contato processado ainda.</p>
        )}
      </div>
    </Card>
  );
}

export function AddJobPage({
  active,
  jobId,
  onSelectJob,
}: {
  active: boolean;
  jobId: string | null;
  onSelectJob: (id: string) => void;
}) {
  const [jobs, setJobs] = useState<AddJobSummary[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setJobs(await api.addJobs());
    } catch {
      /* lista é secundária */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(id);
  }, [active, load]);

  // Sem job escolhido → abre o mais recente.
  useEffect(() => {
    if (!jobId && jobs[0]) onSelectJob(jobs[0].id);
  }, [jobId, jobs, onSelectJob]);

  return (
    <main className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[320px_1fr] sm:p-6">
      <Card className="flex min-h-0 flex-col">
        <div className="flex items-center justify-between border-b border-dark-border p-4">
          <h2 className="font-semibold">Jobs de adição</h2>
          <Button variant="ghost" onClick={() => load()} disabled={loading} title="Atualizar">
            <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {jobs.map((j) => {
            const done = j.total - j.counts.PENDING;
            return (
              <button
                key={j.id}
                onClick={() => onSelectJob(j.id)}
                className={clsx(
                  'mb-1 w-full rounded-lg p-3 text-left transition',
                  jobId === j.id ? 'bg-brand-cyan/10' : 'hover:bg-dark-hover',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{j.groupName}</span>
                  <span className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[10px]', JOB_LABEL[j.status].cls)}>
                    {JOB_LABEL[j.status].text}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar counts={j.counts} total={j.total} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-content-muted">
                  <span>{new Date(j.createdAt).toLocaleString('pt-BR')}</span>
                  <span className="tabular-nums">
                    {done}/{j.total}
                  </span>
                </div>
              </button>
            );
          })}
          {!jobs.length && (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-content-muted">
              <UserPlus size={28} />
              Nenhum job ainda. Na aba Contatos, selecione contatos e clique em “Adicionar ao grupo…”.
            </div>
          )}
        </div>
      </Card>

      <div className="flex min-h-[60vh] flex-col lg:min-h-0">
        {jobId ? (
          <JobDetail key={jobId} jobId={jobId} active={active} onChanged={() => load(true)} />
        ) : (
          <Card className="flex flex-1 items-center justify-center p-8 text-center text-content-secondary">
            Selecione um job para ver o progresso.
          </Card>
        )}
      </div>
    </main>
  );
}
