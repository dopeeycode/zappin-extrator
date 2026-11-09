import { useId, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, Save, Upload } from 'lucide-react';
import { api } from '../api';
import { Modal } from './Modal';
import { Button } from './ui';
import { useToast } from './Toast';

export interface ParsedItem {
  phone: string;
  name: string | null;
}

/**
 * Converte linhas de texto (de arquivo .txt ou colado) em lista de contatos válidos.
 * Aceita:
 * - Apenas números: "5511917551613" (formato padrão exportado pelo zapin-extrator)
 * - Números com pontuação: "+55 11 91755-1613" ou "+55 (11) 91755-1613"
 * - CSV/TSV: "5511917551613;Nome" ou "Nome, 5511917551613"
 */
export function parseNumbersText(rawText: string): {
  items: ParsedItem[];
  totalLines: number;
  discarded: number;
} {
  const lines = rawText.split(/\r?\n/);
  const seen = new Set<string>();
  const items: ParsedItem[] = [];
  let totalLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    totalLines++;

    let phone: string | null = null;
    let name: string | null = null;

    if (/[;\t,]/.test(line)) {
      const parts = line.split(/[;\t,]/).map((p) => p.trim().replace(/^["']|["']$/g, ''));
      const phoneIdx = parts.findIndex((p) => {
        const d = p.replace(/[\s+()\-.]/g, '');
        return /^[1-9]\d{7,14}$/.test(d);
      });

      if (phoneIdx !== -1) {
        phone = parts[phoneIdx].replace(/[\s+()\-.]/g, '');
        const nameParts = parts.filter((_, idx) => idx !== phoneIdx && _);
        if (nameParts.length > 0) {
          name = nameParts.join(' ').trim().slice(0, 150) || null;
        }
      }
    }

    if (!phone) {
      const clean = line.replace(/[\s+()\-.]/g, '');
      if (/^[1-9]\d{7,14}$/.test(clean)) {
        phone = clean;
      }
    }

    if (phone && !seen.has(phone)) {
      seen.add(phone);
      items.push({ phone, name });
    }
  }

  return {
    items,
    totalLines,
    discarded: totalLines - items.length,
  };
}

function formatPhoneDisplay(digits: string): string {
  if (/^55[1-9]\d\d{8,9}$/.test(digits)) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    const split = rest.length - 4;
    return `+55 ${ddd} ${rest.slice(0, split)}-${rest.slice(split)}`;
  }
  return `+${digits}`;
}

export function ImportTxtModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileInputId = useId();
  const toast = useToast();
  const [text, setText] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const { items, totalLines, discarded } = useMemo(() => parseNumbersText(text), [text]);

  const handleFile = async (file: File) => {
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      if (!sourceName.trim()) {
        const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ');
        setSourceName(cleanName);
      }
    } catch {
      toast('Não foi possível ler o arquivo selecionado.', 'error');
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleSave = async () => {
    if (!items.length) return;
    setSaving(true);

    try {
      const name = sourceName.trim() || fileName || 'Importação .txt';
      const sourceId = `import_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${Date.now().toString(36)}`;

      // Chunk para respeitar o limite de 2500 por lote sem estourar o backend
      const CHUNK = 2500;
      let totalCreated = 0;
      let totalUpdated = 0;
      let totalSkipped = 0;

      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK).map((c) => ({
          phone: c.phone,
          name: c.name,
          role: 'member' as const,
        }));
        const res = await api.importContacts({ id: sourceId, name }, chunk);
        totalCreated += res.created;
        totalUpdated += res.updated;
        totalSkipped += res.skipped;
      }

      toast(
        `${totalCreated} contato(s) salvo(s)${totalUpdated ? `, ${totalUpdated} já existiam (atualizados)` : ''}${
          totalSkipped ? `, ${totalSkipped} ignorados` : ''
        }.`,
        'success',
      );

      setText('');
      setSourceName('');
      setFileName(null);
      onSuccess();
      onClose();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Importar contatos (.txt ou lista)"
      className="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !items.length}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Salvar {items.length} contato(s)
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-content-secondary">
            Identificação / Origem da lista (opcional)
          </label>
          <input
            type="text"
            value={sourceName}
            onChange={(e) => setSourceName(e.target.value)}
            placeholder="Ex.: Lista Grupo SP, Contatos Importados..."
            className="mt-1 w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm outline-none placeholder:text-content-muted focus:border-brand-cyan/50"
          />
          <p className="mt-1 text-xs text-content-muted">
            Este nome aparecerá no filtro de grupos na aba Contatos para facilitar a organização.
          </p>
        </div>

        {/* Área de Upload / Drag & Drop */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          className={`relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
            dragActive
              ? 'border-brand-cyan bg-brand-cyan/10'
              : 'border-dark-border bg-dark-bg/60 hover:border-brand-cyan/40 hover:bg-dark-hover/40'
          }`}
        >
          <input
            id={fileInputId}
            type="file"
            accept=".txt,.csv"
            onChange={onFileChange}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
          <Upload size={24} className="mb-2 text-brand-cyan" />
          <p className="text-sm font-medium text-content-primary">
            {fileName ? (
              <span className="text-brand-cyan font-mono">{fileName}</span>
            ) : (
              'Arraste um arquivo .txt aqui ou clique para selecionar'
            )}
          </p>
          <p className="mt-0.5 text-xs text-content-muted">
            Formato: 1 número por linha (ex.: 5511999999999), exatamente como o .txt exportado
          </p>
        </div>

        {/* Textarea para colar diretamente */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-content-secondary">
            <span>Ou cole os números diretamente abaixo:</span>
            {text && (
              <button
                type="button"
                onClick={() => {
                  setText('');
                  setFileName(null);
                }}
                className="text-brand-cyan hover:underline"
              >
                Limpar
              </button>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={`5511911814921\n5511958203601\n5521998797621`}
            className="w-full resize-none rounded-lg border border-dark-border bg-dark-bg p-3 font-mono text-xs outline-none placeholder:text-content-muted focus:border-brand-cyan/50"
          />
        </div>

        {/* Resumo do parse */}
        {totalLines > 0 && (
          <div className="rounded-lg border border-dark-border bg-dark-bg p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-brand-success">
                <CheckCircle2 size={14} />
                {items.length} número(s) válido(s) identificado(s)
              </span>
              {discarded > 0 && (
                <span className="flex items-center gap-1.5 text-brand-warning">
                  <AlertCircle size={14} />
                  {discarded} linha(s) ignorada(s) ou repetida(s)
                </span>
              )}
            </div>

            {items.length > 0 && (
              <div>
                <p className="text-[11px] text-content-muted mb-1">Pré-visualização dos primeiros números:</p>
                <div className="max-h-24 overflow-y-auto rounded bg-dark-card/60 p-2 text-xs font-mono text-content-secondary space-y-1">
                  {items.slice(0, 10).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between">
                      <span>{formatPhoneDisplay(item.phone)}</span>
                      {item.name && <span className="text-content-muted">{item.name}</span>}
                    </div>
                  ))}
                  {items.length > 10 && (
                    <div className="text-[10px] text-content-muted italic">
                      + mais {items.length - 10} número(s)...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
