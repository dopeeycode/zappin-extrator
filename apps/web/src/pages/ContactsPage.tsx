import { useCallback, useEffect, useMemo, useState } from 'react';
import { Contact as ContactIcon, FileUp, Loader2, MessageCircle, RefreshCw, Shield, Trash2, UserPlus } from 'lucide-react';
import { api, type Contact, type ContactSource } from '../api';
import { Avatar, Button, Card, Checkbox, SearchInput } from '../components/ui';
import { MessagePanel } from '../components/MessagePanel';
import { AddJobModal } from '../components/AddJobModal';
import { ImportTxtModal } from '../components/ImportTxtModal';
import { useToast } from '../components/Toast';

export function ContactsPage({ active, onJobCreated }: { active: boolean; onJobCreated: (jobId: string) => void }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sourceGroup, setSourceGroup] = useState('');
  const [items, setItems] = useState<Contact[]>([]);
  const [sources, setSources] = useState<ContactSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openContact, setOpenContact] = useState<Contact | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.contacts({ search: debounced, sourceGroup });
      setItems(r.items);
      setSources(r.sources);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [debounced, sourceGroup, toast]);

  // Recarrega ao abrir a aba (contatos podem ter sido salvos na aba Extrair) e ao filtrar.
  useEffect(() => {
    if (active) load();
  }, [active, load]);

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const someSelected = items.some((c) => selected.has(c.id));
  const selectedIds = useMemo(() => [...selected], [selected]);

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of items) {
        if (allSelected) next.delete(c.id);
        else next.add(c.id);
      }
      return next;
    });

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const remove = async () => {
    if (!confirm(`Excluir ${selected.size} contato(s)? O histórico de mensagens deles também será apagado.`)) return;
    try {
      const r = await api.deleteContacts(selectedIds);
      toast(`${r.deleted} contato(s) excluído(s).`, 'success');
      setSelected(new Set());
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
      <Card className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-3 border-b border-dark-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Contatos salvos <span className="text-content-muted">({items.length})</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                <FileUp size={16} /> Importar .txt
              </Button>
              <Button variant="primary" onClick={() => setAddOpen(true)} disabled={!selected.size}>
                <UserPlus size={16} /> Adicionar ao grupo…
              </Button>
              <Button variant="danger" onClick={remove} disabled={!selected.size}>
                <Trash2 size={16} /> Excluir
              </Button>
              <Button variant="ghost" onClick={load} disabled={loading} title="Atualizar">
                <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SearchInput
              className="min-w-[240px] flex-1"
              value={search}
              onChange={setSearch}
              placeholder="Buscar por nome ou número…"
            />
            <select
              value={sourceGroup}
              onChange={(e) => setSourceGroup(e.target.value)}
              className="rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm outline-none focus:border-brand-cyan/50"
            >
              <option value="">Todos os grupos de origem</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3 text-sm text-content-secondary">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} disabled={!items.length} />
              Selecionar todos (visíveis)
            </label>
            {selected.size > 0 && (
              <>
                <span>· {selected.size} selecionado(s)</span>
                <button className="text-brand-cyan hover:underline" onClick={() => setSelected(new Set())}>
                  limpar
                </button>
              </>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !items.length ? (
            <div className="flex justify-center p-8 text-content-muted">
              <Loader2 className="animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-content-muted">
              <ContactIcon size={36} />
              <p>
                {debounced || sourceGroup
                  ? 'Nenhum contato encontrado com esse filtro.'
                  : 'Nenhum contato salvo ainda. Extraia um grupo e salve, ou importe um arquivo .txt com números.'}
              </p>
              {!debounced && !sourceGroup && (
                <Button variant="secondary" onClick={() => setImportOpen(true)} className="mt-1">
                  <FileUp size={16} /> Importar arquivo .txt
                </Button>
              )}
            </div>
          ) : (
            items.map((c) => (
              <div
                key={c.id}
                onClick={() => setOpenContact(c)}
                className="flex cursor-pointer items-center gap-3 border-b border-dark-border/50 px-4 py-2.5 hover:bg-dark-hover/40"
              >
                <Checkbox checked={selected.has(c.id)} onChange={(on) => toggle(c.id, on)} />
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-sm">{c.formatted}</div>
                  <div className="truncate text-xs text-content-muted">{c.name ?? 'Sem nome'}</div>
                </div>
                <div className="hidden min-w-0 max-w-[30%] text-right text-xs text-content-muted md:block">
                  <div className="truncate">{c.sourceGroupName ?? '—'}</div>
                  <div>{new Date(c.createdAt).toLocaleDateString('pt-BR')}</div>
                </div>
                {c.wasAdmin && (
                  <span title="Era admin no grupo de origem">
                    <Shield size={14} className="shrink-0 text-brand-success" />
                  </span>
                )}
                <MessageCircle size={16} className="shrink-0 text-content-muted" />
              </div>
            ))
          )}
        </div>
      </Card>

      {openContact && <MessagePanel contact={openContact} onClose={() => setOpenContact(null)} />}

      <AddJobModal
        open={addOpen}
        contactIds={selectedIds}
        onClose={() => setAddOpen(false)}
        onCreated={(id) => {
          setAddOpen(false);
          setSelected(new Set());
          onJobCreated(id);
        }}
      />

      <ImportTxtModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={load}
      />
    </main>
  );
}

