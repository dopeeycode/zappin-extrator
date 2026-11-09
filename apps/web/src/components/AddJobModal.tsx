import { useEffect, useMemo, useState } from 'react';
import { Info, Loader2, Play, Shield } from 'lucide-react';
import { api, type AddLimits, type AddSettings, type Group } from '../api';
import { Modal } from './Modal';
import { Button } from './ui';
import { useToast } from './Toast';

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-content-secondary">{label}</span>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3 focus-within:border-brand-cyan/50">
        <input
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className="w-full bg-transparent py-2 tabular-nums outline-none"
        />
        {suffix && <span className="text-xs text-content-muted">{suffix}</span>}
      </div>
      <span className="text-[11px] text-content-muted">
        {max !== undefined ? `${min} a ${max}` : `mínimo ${min}`}
      </span>
    </label>
  );
}

function clamp(n: number, min: number, max = Infinity) {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? Math.round(n) : min));
}

function formatDuration(sec: number) {
  if (sec < 90) return `~${Math.max(1, Math.round(sec))} s`;
  const min = sec / 60;
  if (min < 90) return `~${Math.round(min)} min`;
  return `~${(min / 60).toFixed(1).replace('.', ',')} h`;
}

/** Configura e inicia um job de adição a um grupo onde sou admin. */
export function AddJobModal({
  open,
  contactIds,
  onClose,
  onCreated,
}: {
  open: boolean;
  contactIds: string[];
  onClose: () => void;
  onCreated: (jobId: string) => void;
}) {
  const toast = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [limits, setLimits] = useState<AddLimits | null>(null);
  const [groupJid, setGroupJid] = useState('');
  const [settings, setSettings] = useState<AddSettings>({ batchSize: 5, minDelaySec: 60, maxDelaySec: 180, dailyLimit: 50 });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setGroups(null);
    Promise.all([api.adminGroups(), api.addLimits()])
      .then(([g, l]) => {
        setGroups(g);
        setLimits(l);
        setSettings({
          batchSize: l.limits.batchSize.default,
          minDelaySec: l.limits.minDelaySec.default,
          maxDelaySec: l.limits.maxDelaySec.default,
          dailyLimit: l.limits.dailyLimit.default,
        });
        setGroupJid((prev) => (g.some((x) => x.id === prev) ? prev : (g[0]?.id ?? '')));
      })
      .catch((e) => setError((e as Error).message));
  }, [open]);

  const L = limits?.limits;
  const safe = useMemo<AddSettings | null>(() => {
    if (!L) return null;
    const minDelaySec = clamp(settings.minDelaySec, L.minDelaySec.min, L.maxDelaySec.max);
    return {
      batchSize: clamp(settings.batchSize, L.batchSize.min, L.batchSize.max),
      minDelaySec,
      maxDelaySec: clamp(settings.maxDelaySec, minDelaySec, L.maxDelaySec.max),
      dailyLimit: clamp(settings.dailyLimit, L.dailyLimit.min, L.dailyLimit.max),
    };
  }, [settings, L]);

  const summary = useMemo(() => {
    if (!safe || !limits) return null;
    const n = contactIds.length;
    const batches = Math.ceil(n / safe.batchSize);
    const avgDelay = (safe.minDelaySec + safe.maxDelaySec) / 2;
    const leftToday = Math.max(0, safe.dailyLimit - limits.dailyUsed);
    return {
      n,
      batches,
      time: formatDuration(Math.max(0, batches - 1) * avgDelay),
      leftToday,
      days: n > leftToday ? 1 + Math.ceil((n - leftToday) / safe.dailyLimit) : 1,
    };
  }, [safe, limits, contactIds.length]);

  const start = async () => {
    if (!safe || !groupJid) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.createAddJob({ groupJid, contactIds, ...safe });
      toast(
        res.alreadyIn
          ? `Job iniciado: ${res.total - res.alreadyIn} para adicionar (${res.alreadyIn} já estavam no grupo).`
          : `Job iniciado com ${res.total} contatos.`,
        'success',
      );
      onCreated(res.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const set = (key: keyof AddSettings) => (n: number) => setSettings((s) => ({ ...s, [key]: n }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adicionar ${contactIds.length} contato(s) a um grupo`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={start} disabled={creating || !groupJid || !safe || !contactIds.length}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Iniciar
          </Button>
        </>
      }
    >
      {!groups && !error ? (
        <div className="flex justify-center p-8 text-content-muted">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="flex items-center gap-1.5 text-content-secondary">
              <Shield size={14} className="text-brand-success" /> Grupo (só onde você é admin)
            </span>
            <select
              value={groupJid}
              onChange={(e) => setGroupJid(e.target.value)}
              className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 outline-none focus:border-brand-cyan/50"
            >
              {groups?.length === 0 && <option value="">Você não é admin de nenhum grupo</option>}
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.size})
                </option>
              ))}
            </select>
          </label>

          {L && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Pessoas por lote"
                value={settings.batchSize}
                onChange={set('batchSize')}
                min={L.batchSize.min}
                max={L.batchSize.max}
              />
              <NumberField
                label="Limite diário"
                value={settings.dailyLimit}
                onChange={set('dailyLimit')}
                min={L.dailyLimit.min}
                max={L.dailyLimit.max}
                suffix="pessoas/24h"
              />
              <NumberField
                label="Intervalo mínimo"
                value={settings.minDelaySec}
                onChange={set('minDelaySec')}
                min={L.minDelaySec.min}
                suffix="s"
              />
              <NumberField
                label="Intervalo máximo"
                value={settings.maxDelaySec}
                onChange={set('maxDelaySec')}
                min={safe?.minDelaySec ?? L.minDelaySec.min}
                max={L.maxDelaySec.max}
                suffix="s"
              />
            </div>
          )}

          {summary && safe && (
            <div className="rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 p-3 text-sm">
              <b>{summary.time}</b> para {summary.n} contatos ({summary.batches} lote(s) de até{' '}
              {safe.batchSize}, com {safe.minDelaySec}–{safe.maxDelaySec}s entre lotes).
              {summary.n > summary.leftToday && (
                <span className="mt-1 block text-brand-warning">
                  Restam {summary.leftToday} adições hoje (limite diário somando todos os jobs). O job pausa sozinho ao
                  atingir o limite — serão necessários ~{summary.days} dia(s).
                </span>
              )}
            </div>
          )}

          <p className="flex items-start gap-2 text-xs text-content-secondary">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>
              Adicionar muita gente de uma vez é o que mais leva o WhatsApp a restringir o número e o grupo. Por isso os
              lotes são pequenos, o intervalo é aleatório e há um teto diário. Quem bloqueia ser adicionado
              (privacidade) não é forçado: aparece na tela com a opção de enviar o convite manualmente. O job pausa
              sozinho se o grupo encher, se você perder o admin ou se o WhatsApp desconectar.
            </span>
          </p>

          {error && (
            <p className="rounded-lg border border-brand-error/30 bg-brand-error/10 p-2 text-sm text-brand-error">{error}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
