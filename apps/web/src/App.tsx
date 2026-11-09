import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Contact as ContactIcon, Loader2, LogOut, QrCode, Smartphone, UserPlus, Users } from 'lucide-react';
import { api, type Session } from './api';
import { Button, Card } from './components/ui';
import { ToastProvider } from './components/Toast';
import { ExtractPage } from './pages/ExtractPage';
import { ContactsPage } from './pages/ContactsPage';
import { AddJobPage } from './pages/AddJobPage';

type Tab = 'extract' | 'contacts' | 'jobs';

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

/* ----------------------------------- App ----------------------------------- */

function AppInner() {
  const [session, setSession] = useState<Session | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [tab, setTab] = useState<Tab>('extract');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

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

  const logout = async () => {
    if (!confirm('Desconectar este aparelho do WhatsApp?')) return;
    setSession(await api.logout());
  };

  const navItems: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'extract', label: 'Extrair', icon: <Users size={16} /> },
    { id: 'contacts', label: 'Contatos', icon: <ContactIcon size={16} /> },
    { id: 'jobs', label: 'Adicionar a grupo', icon: <UserPlus size={16} /> },
  ];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-dark-border bg-dark-sidebar px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Users className="text-brand-cyan" size={20} />
            <h1 className="font-semibold">Zapin Extrator</h1>
          </div>

          {connected && (
            <nav className="flex items-center gap-1">
              {navItems.map((n) => (
                <button
                  key={n.id}
                  onClick={() => setTab(n.id)}
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition',
                    tab === n.id
                      ? 'bg-brand-cyan/15 text-brand-cyan'
                      : 'text-content-secondary hover:bg-dark-hover hover:text-content-primary',
                  )}
                >
                  {n.icon}
                  <span>{n.label}</span>
                </button>
              ))}
            </nav>
          )}
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
        <>
          {tab === 'extract' && <ExtractPage />}
          {tab === 'contacts' && (
            <ContactsPage
              active={tab === 'contacts'}
              onJobCreated={(id) => {
                setSelectedJobId(id);
                setTab('jobs');
              }}
            />
          )}
          {tab === 'jobs' && (
            <AddJobPage active={tab === 'jobs'} jobId={selectedJobId} onSelectJob={setSelectedJobId} />
          )}
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
