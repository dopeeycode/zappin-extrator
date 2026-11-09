import { useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Copy,
  Download,
  EyeOff,
  FileJson,
  FileSpreadsheet,
  FileText,
  Loader2,
  LogOut,
  Phone,
  QrCode,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Users,
} from 'lucide-react';
import {
  api,
  type Extraction,
  type ExportFile,
  type Group,
  type HiddenReason,
  type Member,
  type Session,
} from './api';

type Filter = 'all' | 'phone' | 'hidden' | 'admins';

const HIDDEN_LABEL: Record<HiddenReason, string> = {
  'lid-hidden': 'Número oculto pelo WhatsApp',
  invalid: 'Descartado: valor recebido não é um telefone válido',
  conflict: 'Descartado: dados conflitantes no servidor',
  unverified: 'Descartado: servidor não confirmou o número',
};

function downloadBlob(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx('rounded-xl border border-dark-border bg-dark-card', className)}>{children}</div>;
}

function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      {...props}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' && 'bg-brand-cyan text-dark-bg hover:bg-brand-cyan/90',
        variant === 'secondary' && 'border border-dark-border bg-dark-hover text-content-primary hover:border-brand-cyan/40',
        variant === 'ghost' && 'text-content-secondary hover:bg-dark-hover hover:text-content-primary',
        className,
      )}
    />
  );
}

function Avatar({ member }: { member: Member }) {
  const letter = (member.name ?? '').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase();
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-dark-hover text-sm font-semibold text-brand-cyan">
      {letter || <Users size={16} className="text-content-muted" />}
    </div>
  );
}

/* --------------------------------- Conexão --------------------------------- */

function ConnectionScreen({ session, onConnect }: { session: Session; onConnect: () => void }) {
  const waiting = session.status === 'CONNECTING';
  return (
    <div className="mx-auto mt-16 max-w-md px-4">
      <Card className="p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-cyan/10 text-brand-cyan">
          <QrCode size={24} />
        </div>
        <h2 className="text-lg font-semibold">Conectar WhatsApp</h2>
        <p className="mt-1 text-sm text-content-secondary">
          Escaneie o QR Code em <b>WhatsApp → Aparelhos conectados → Conectar aparelho</b>.
        </p>

        <div className="mt-6 flex justify-center">
          {session.qrCodeDataUrl ? (
            <img src={session.qrCodeDataUrl} alt="QR Code" className="h-64 w-64 rounded-lg bg-white p-2" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-dark-border text-content-muted">
              {waiting ? <Loader2 className="animate-spin" /> : 'Nenhum QR gerado'}
            </div>
          )}
        </div>

        {session.error && <p className="mt-4 text-sm text-brand-error">{session.error}</p>}

        {session.status !== 'QR_READY' && (
          <Button variant="primary" className="mt-6 w-full" onClick={onConnect} disabled={waiting}>
            {waiting ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
            {waiting ? 'Gerando QR Code…' : 'Gerar QR Code'}
          </Button>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- Grupos ---------------------------------- */

function GroupList({
  groups,
  loading,
  selected,
  onSelect,
  onRefresh,
}: {
  groups: Group[];
  loading: boolean;
  selected: string | null;
  onSelect: (g: Group) => void;
  onRefresh: () => void;
}) {
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () => groups.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())),
    [groups, q],
  );

  return (
    <Card className="flex min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-dark-border p-4">
        <h2 className="font-semibold">
          Seus grupos <span className="text-content-muted">({groups.length})</span>
        </h2>
        <Button variant="ghost" onClick={onRefresh} disabled={loading} title="Atualizar">
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="p-3">
        <div className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3">
          <Search size={16} className="text-content-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar grupo…"
            className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-content-muted"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {loading && groups.length === 0 && (
          <div className="flex justify-center p-6 text-content-muted">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {filtered.map((g) => (
          <button
            key={g.id}
            onClick={() => onSelect(g)}
            className={clsx(
              'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition',
              selected === g.id ? 'bg-brand-cyan/10 text-brand-cyan' : 'hover:bg-dark-hover',
            )}
          >
            <span className="truncate text-sm">{g.name}</span>
            <span className="flex shrink-0 items-center gap-2 text-xs text-content-muted">
              {g.isAdmin && <Shield size={12} className="text-brand-success" />}
              {g.size}
            </span>
          </button>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="p-6 text-center text-sm text-content-muted">Nenhum grupo encontrado.</p>
        )}
      </div>
    </Card>
  );
}

/* --------------------------------- Membros --------------------------------- */

function MembersPanel({ data }: { data: Extraction }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [copied, setCopied] = useState(false);

  const visible = useMemo(() => {
    const term = q.toLowerCase().replace(/\D/g, '') || null;
    const text = q.toLowerCase();
    return data.members.filter((m) => {
      if (filter === 'phone' && !m.phone) return false;
      if (filter === 'hidden' && m.phone) return false;
      if (filter === 'admins' && m.role === 'member') return false;
      if (!q) return true;
      return (term && m.phone?.includes(term)) || m.name?.toLowerCase().includes(text);
    });
  }, [data, q, filter]);

  const phones = useMemo(() => data.members.filter((m) => m.phone).map((m) => m.phone!), [data]);
  const base = `${slug(data.group.name) || 'grupo'}`;

  const copyAll = async () => {
    await navigator.clipboard.writeText(phones.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const exportVcf = () => {
    const cards = data.members
      .filter((m) => m.phone)
      .map(
        (m) =>
          `BEGIN:VCARD\nVERSION:3.0\nFN:${m.name ?? m.formatted}\nTEL;TYPE=CELL:+${m.phone}\nEND:VCARD`,
      )
      .join('\n');
    downloadBlob(cards, `${base}.vcf`, 'text/vcard');
  };

  const stats: { key: Filter; label: string; value: number; icon: React.ReactNode }[] = [
    { key: 'all', label: 'Membros', value: data.totals.members, icon: <Users size={16} /> },
    { key: 'phone', label: 'Com número', value: data.totals.withPhone, icon: <Phone size={16} /> },
    { key: 'hidden', label: 'Número oculto', value: data.totals.hidden, icon: <EyeOff size={16} /> },
    { key: 'admins', label: 'Admins', value: data.totals.admins, icon: <Shield size={16} /> },
  ];

  return (
    <Card className="flex min-h-0 flex-col">
      <div className="border-b border-dark-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{data.group.name}</h2>
            <p className="text-xs text-content-muted">
              Extraído em {new Date(data.extractedAt).toLocaleString('pt-BR')} · salvo em{' '}
              <span className="font-mono">exports/{data.files.csv}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={copyAll} disabled={!phones.length}>
              {copied ? <Check size={16} className="text-brand-success" /> : <Copy size={16} />}
              {copied ? 'Copiado!' : 'Copiar números'}
            </Button>
            <a href={api.exportUrl(data.files.csv)}>
              <Button>
                <FileSpreadsheet size={16} /> CSV
              </Button>
            </a>
            <a href={api.exportUrl(data.files.txt)}>
              <Button>
                <FileText size={16} /> TXT
              </Button>
            </a>
            <Button onClick={exportVcf} disabled={!phones.length}>
              <Download size={16} /> VCF
            </Button>
            <a href={api.exportUrl(data.files.json)}>
              <Button>
                <FileJson size={16} /> JSON
              </Button>
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map((s) => (
            <button
              key={s.key}
              onClick={() => setFilter(s.key)}
              className={clsx(
                'rounded-lg border p-3 text-left transition',
                filter === s.key
                  ? 'border-brand-cyan/50 bg-brand-cyan/5'
                  : 'border-dark-border bg-dark-bg hover:border-dark-hover',
              )}
            >
              <div className="flex items-center gap-2 text-xs text-content-secondary">
                {s.icon} {s.label}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{s.value}</div>
            </button>
          ))}
        </div>

        <p className="mt-3 flex items-center gap-1.5 text-xs text-content-secondary">
          <BadgeCheck size={14} className="text-brand-success" />
          {data.totals.verified} confirmados numa 2ª consulta ao servidor ·{' '}
          {data.totals.withPhone - data.totals.verified} vindos direto do servidor ·{' '}
          {data.totals.discarded} descartados por dúvida
        </p>

        {data.warnings.map((w) => (
          <p
            key={w}
            className="mt-2 flex items-start gap-2 rounded-lg border border-brand-warning/30 bg-brand-warning/10 p-2 text-xs text-brand-warning"
          >
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
          </p>
        ))}

        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dark-border bg-dark-bg px-3">
          <Search size={16} className="text-content-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou número…"
            className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-content-muted"
          />
          <span className="shrink-0 text-xs text-content-muted">{visible.length}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map((m) => (
          <div key={m.jid} className="flex items-center gap-3 border-b border-dark-border/50 px-4 py-2.5">
            <Avatar member={m} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-sm">
                {m.formatted ? (
                  <>
                    <span className="font-mono">{m.formatted}</span>
                    {m.verified && (
                      <span title="Confirmado numa segunda consulta ao servidor do WhatsApp">
                        <BadgeCheck size={14} className="text-brand-success" />
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-content-muted">{HIDDEN_LABEL[m.hiddenReason ?? 'lid-hidden']}</span>
                )}
              </div>
              <div className="truncate text-xs text-content-muted">{m.name ?? m.jid}</div>
            </div>
            {m.role !== 'member' && (
              <span className="shrink-0 rounded bg-brand-success/10 px-2 py-0.5 text-xs text-brand-success">
                {m.role === 'superadmin' ? 'Criador' : 'Admin do grupo'}
              </span>
            )}
          </div>
        ))}
        {visible.length === 0 && <p className="p-8 text-center text-sm text-content-muted">Nenhum membro.</p>}
      </div>
    </Card>
  );
}

function ExportsList({ files }: { files: ExportFile[] }) {
  if (!files.length) return null;
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-semibold">Arquivos salvos</h3>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {files.map((f) => (
          <a
            key={f.name}
            href={api.exportUrl(f.name)}
            className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-dark-hover"
          >
            <span className="truncate font-mono text-content-secondary">{f.name}</span>
            <Download size={12} className="shrink-0 text-content-muted" />
          </a>
        ))}
      </div>
    </Card>
  );
}

/* ----------------------------------- App ----------------------------------- */

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [selected, setSelected] = useState<Group | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [verifyAll, setVerifyAll] = useState(false);

  const connected = session?.status === 'CONNECTED';

  // Polling da sessão (QR / status)
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.session();
        if (alive) {
          setSession(s);
          setApiDown(false);
        }
      } catch {
        if (alive) setApiDown(true);
      }
    };
    tick();
    const id = setInterval(tick, connected ? 10_000 : 2_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connected]);

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true);
    setError(null);
    try {
      setGroups(await api.groups());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingGroups(false);
    }
  }, []);

  const loadFiles = useCallback(() => api.exports().then(setFiles).catch(() => {}), []);

  useEffect(() => {
    if (connected) {
      loadGroups();
      loadFiles();
    }
  }, [connected, loadGroups, loadFiles]);

  const extract = async (g: Group) => {
    setSelected(g);
    setExtracting(true);
    setError(null);
    try {
      setExtraction(await api.members(g.id, verifyAll));
      loadFiles();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
    }
  };

  const logout = async () => {
    if (!confirm('Desconectar este aparelho do WhatsApp?')) return;
    setSession(await api.logout());
    setGroups([]);
    setExtraction(null);
    setSelected(null);
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-dark-border bg-dark-sidebar px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <Users className="text-brand-cyan" size={20} />
          <h1 className="font-semibold">Zapin Extrator</h1>
          <span className="hidden text-sm text-content-muted sm:inline">· membros de grupos</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-2">
            <span
              className={clsx(
                'h-2 w-2 rounded-full',
                apiDown ? 'bg-brand-error' : connected ? 'bg-brand-success' : 'bg-brand-warning',
              )}
            />
            <span className="text-content-secondary">
              {apiDown
                ? 'API offline'
                : connected
                  ? `+${session?.connectedPhone ?? ''}`
                  : (session?.status ?? '…')}
            </span>
          </span>
          {connected && (
            <Button variant="ghost" onClick={logout} title="Desconectar">
              <LogOut size={16} />
            </Button>
          )}
        </div>
      </header>

      {apiDown && (
        <p className="mx-auto mt-16 max-w-md px-4 text-center text-content-secondary">
          Não foi possível falar com a API. Rode <code className="font-mono text-brand-cyan">npm run dev</code> na
          pasta do projeto.
        </p>
      )}

      {!apiDown && session && !connected && (
        <ConnectionScreen session={session} onConnect={() => api.connect().then(setSession)} />
      )}

      {connected && (
        <main className="grid min-h-0 flex-1 gap-4 p-4 lg:grid-cols-[340px_1fr] sm:p-6">
          <div className="flex min-h-0 flex-col gap-4">
            <GroupList
              groups={groups}
              loading={loadingGroups}
              selected={selected?.id ?? null}
              onSelect={extract}
              onRefresh={loadGroups}
            />
            <Card className="p-4">
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={verifyAll}
                  onChange={(e) => setVerifyAll(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#22D3EE]"
                />
                <span>
                  Reconfirmar <b>todos</b> os números no servidor
                  <span className="block text-xs text-content-muted">
                    Dupla checagem número ↔ membro. Mais lento em grupos grandes (~1s a cada 50 membros).
                  </span>
                </span>
              </label>
            </Card>
            <ExportsList files={files} />
          </div>

          <div className="flex min-h-[60vh] flex-col lg:min-h-0">
            {error && (
              <div className="mb-3 rounded-lg border border-brand-error/30 bg-brand-error/10 p-3 text-sm text-brand-error">
                {error}
              </div>
            )}
            {extracting ? (
              <Card className="flex flex-1 flex-col items-center justify-center gap-3 text-content-secondary">
                <Loader2 className="animate-spin text-brand-cyan" size={28} />
                Lendo membros de “{selected?.name}”…
              </Card>
            ) : extraction ? (
              <MembersPanel data={extraction} />
            ) : (
              <Card className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-content-secondary">
                <Users size={32} className="text-content-muted" />
                Selecione um grupo à esquerda para extrair todos os números dos membros.
              </Card>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
