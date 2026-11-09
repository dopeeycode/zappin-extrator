import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ExternalLink, Loader2, Send, X } from 'lucide-react';
import { api, type Contact, type MessageLog } from '../api';
import { Avatar, Button } from './ui';
import { useToast } from './Toast';

/**
 * Painel lateral para mandar mensagem para UM contato. O envio é sempre manual
 * (um clique = uma mensagem para uma pessoa) — não existe disparo em massa.
 */
export function MessagePanel({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<MessageLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setText('');
    api
      .messages(contact.id)
      .then((h) => alive && setHistory(h))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [contact.id]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      const log = await api.sendMessage(contact.id, body);
      setHistory((h) => [log, ...h]);
      setText('');
      toast('Mensagem enviada.', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
      api.messages(contact.id).then(setHistory).catch(() => {});
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40" onMouseDown={onClose}>
      <aside
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l border-dark-border bg-dark-card shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-dark-border p-4">
          <Avatar name={contact.name} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm">{contact.formatted}</div>
            <div className="truncate text-xs text-content-muted">{contact.name ?? 'Sem nome'}</div>
          </div>
          <a
            href={`https://wa.me/${contact.phone}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-brand-cyan hover:bg-dark-hover"
          >
            Abrir no WhatsApp <ExternalLink size={12} />
          </a>
          <button onClick={onClose} className="rounded p-1 text-content-muted hover:bg-dark-hover hover:text-content-primary">
            <X size={18} />
          </button>
        </header>

        <div className="border-b border-dark-border p-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
            }}
            rows={5}
            maxLength={4000}
            placeholder="Escreva a mensagem…"
            className="w-full resize-none rounded-lg border border-dark-border bg-dark-bg p-3 text-sm outline-none placeholder:text-content-muted focus:border-brand-cyan/50"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-content-muted">
              Envio individual com “digitando…” antes. Ctrl+Enter envia.
            </span>
            <Button variant="primary" onClick={send} disabled={sending || !text.trim()}>
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? 'Enviando…' : 'Enviar'}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">Histórico</h3>
          {loading ? (
            <div className="flex justify-center p-6 text-content-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-content-muted">Nenhuma mensagem enviada para este contato.</p>
          ) : (
            <ul className="space-y-2">
              {history.map((m) => (
                <li
                  key={m.id}
                  className={clsx(
                    'rounded-lg border p-3 text-sm',
                    m.status === 'SENT' ? 'border-dark-border bg-dark-bg' : 'border-brand-error/30 bg-brand-error/5',
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.text}</p>
                  <p className={clsx('mt-1 text-xs', m.status === 'SENT' ? 'text-content-muted' : 'text-brand-error')}>
                    {new Date(m.sentAt).toLocaleString('pt-BR')} · {m.status === 'SENT' ? 'enviada' : `falhou: ${m.error}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

