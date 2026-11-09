import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  USyncQuery,
  USyncUser,
  type Contact,
  type GroupMetadata,
  type WASocket,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { jidUser, pnJidToDigits } from './phone.js';
import { discard, resolveParticipants } from './resolver.js';
import type {
  ConnectionStatus,
  ExportFileDTO,
  ExtractionDTO,
  GroupDTO,
  MemberDTO,
  SessionDTO,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Pasta de sessão própria: este app é um "aparelho conectado" separado do zapin.
const AUTH_DIR = path.resolve(__dirname, '../.baileys_auth');
export const EXPORTS_DIR = path.resolve(__dirname, '../exports');

const VERIFY_CHUNK = 50;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 50) || 'grupo'
  );
}

function csvCell(value: string | null): string {
  const v = value ?? '';
  return /[",;\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(1500 * (i + 1));
    }
  }
  throw lastErr;
}

class WhatsAppService {
  private socket: WASocket | null = null;
  private status: ConnectionStatus = 'DISCONNECTED';
  private qrCodeDataUrl: string | null = null;
  private connectedPhone: string | null = null;
  private connectedName: string | null = null;
  private lastError: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private connecting = false;

  /** Nomes conhecidos (agenda / pushName) indexados por JID e por LID */
  private contacts = new Map<string, string>();

  constructor() {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  hasSavedSession(): boolean {
    return fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
  }

  getSession(): SessionDTO {
    return {
      status: this.status,
      qrCodeDataUrl: this.qrCodeDataUrl,
      connectedPhone: this.connectedPhone,
      connectedName: this.connectedName,
      error: this.lastError,
    };
  }

  async connect(): Promise<void> {
    if (this.connecting || this.status === 'CONNECTED') return;
    this.connecting = true;
    this.status = 'CONNECTING';
    this.lastError = null;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.windows('Desktop'),
        syncFullHistory: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: 60_000,
        keepAliveIntervalMs: 30_000,
      });
      this.socket = sock;

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('contacts.upsert', (list) => this.rememberContacts(list));
      sock.ev.on('contacts.update', (list) => this.rememberContacts(list));
      sock.ev.on('messaging-history.set', ({ contacts }) => this.rememberContacts(contacts));

      sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          this.status = 'QR_READY';
          console.log('📲 Novo QR Code gerado — escaneie pelo frontend.');
        }

        if (connection === 'open') {
          this.status = 'CONNECTED';
          this.qrCodeDataUrl = null;
          this.reconnectAttempts = 0;
          this.connecting = false;
          this.connectedPhone = pnJidToDigits(sock.user?.id?.replace(/:\d+@/, '@'));
          this.connectedName = sock.user?.name ?? null;
          console.log(`✅ WhatsApp conectado: ${this.connectedPhone}`);
        }

        if (connection === 'close') {
          this.connecting = false;
          this.status = 'DISCONNECTED';
          const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
            ?.statusCode;
          console.log(`⚠️ Conexão fechada (statusCode ${code}).`);
          if (code === DisconnectReason.loggedOut) {
            await this.logout();
          } else {
            this.scheduleReconnect();
          }
        }
      });
    } catch (err) {
      this.connecting = false;
      this.status = 'ERROR';
      this.lastError = (err as Error).message;
      console.error('❌ Erro ao conectar:', err);
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const delay = Math.min(3000 * 1.5 ** this.reconnectAttempts, 30_000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private rememberContacts(list: Partial<Contact>[]) {
    for (const c of list) {
      const name = c.name || c.notify || c.verifiedName;
      if (!name) continue;
      for (const key of [c.id, c.lid, c.phoneNumber]) {
        if (key) this.contacts.set(key, name);
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.socket?.end(undefined);
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.status = 'DISCONNECTED';
    this.qrCodeDataUrl = null;
    this.connecting = false;
  }

  async logout(): Promise<void> {
    try {
      await this.socket?.logout();
    } catch {
      /* ignore */
    }
    await this.disconnect();
    this.connectedPhone = null;
    this.connectedName = null;
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  private requireSocket(): WASocket {
    if (!this.socket || this.status !== 'CONNECTED') {
      throw Object.assign(new Error('WhatsApp não está conectado.'), { statusCode: 409 });
    }
    return this.socket;
  }

  /** Socket conectado, ou null se o WhatsApp não estiver conectado. */
  getSocket(): WASocket | null {
    return this.socket && this.status === 'CONNECTED' ? this.socket : null;
  }

  /** Acha a conta conectada na lista de participantes (por telefone ou LID). */
  private findMe(sock: WASocket, participants: GroupMetadata['participants']) {
    const myPn = this.connectedPhone;
    const myLid = jidUser(sock.user?.lid);
    return participants.find(
      (p) =>
        (myPn && (pnJidToDigits(p.id) === myPn || pnJidToDigits(p.phoneNumber) === myPn)) ||
        (myLid && (jidUser(p.id) === myLid || jidUser(p.lid) === myLid)),
    );
  }

  async listGroups(): Promise<GroupDTO[]> {
    const sock = this.requireSocket();
    const groups = await withRetry(() => sock.groupFetchAllParticipating());
    return Object.values(groups)
      .map((g) => ({
        id: g.id,
        name: g.subject || 'Grupo sem nome',
        size: g.participants.length || g.size || 0,
        isAdmin: Boolean(this.findMe(sock, g.participants)?.admin),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  async listAdminGroups(): Promise<GroupDTO[]> {
    return (await this.listGroups()).filter((g) => g.isAdmin);
  }

  /**
   * Situação atual do grupo: nome, se sou admin e os telefones que já estão nele.
   * Membros com número oculto (LID sem phone_number) não entram em `phones` —
   * para esses, o WhatsApp responde 409 (já está no grupo) na hora de adicionar.
   */
  async groupSnapshot(groupJid: string): Promise<{ name: string; size: number; isAdmin: boolean; phones: Set<string> }> {
    const sock = this.requireSocket();
    const meta = await withRetry(() => sock.groupMetadata(groupJid));
    const phones = new Set<string>();
    for (const p of meta.participants) {
      const phone = pnJidToDigits(p.id) ?? pnJidToDigits(p.phoneNumber);
      if (phone) phones.add(phone);
    }
    return {
      name: meta.subject || 'Grupo sem nome',
      size: meta.participants.length,
      isAdmin: Boolean(this.findMe(sock, meta.participants)?.admin),
      phones,
    };
  }

  /** Link de convite do grupo (precisa ser admin). */
  async groupInviteLink(groupJid: string): Promise<string> {
    const sock = this.requireSocket();
    const code = await sock.groupInviteCode(groupJid);
    if (!code) throw Object.assign(new Error('Não foi possível obter o link de convite do grupo.'), { statusCode: 502 });
    return `https://chat.whatsapp.com/${code}`;
  }

  /**
   * Envia uma mensagem de texto para UM número, de forma "humanizada" (mesmo padrão do
   * zapin): confirma que o número tem WhatsApp, mostra "digitando…" por um tempo
   * proporcional ao tamanho do texto e só então envia.
   */
  async sendText(phone: string, text: string): Promise<void> {
    const sock = this.requireSocket();
    const jid = `${phone}@s.whatsapp.net`;
    if (pnJidToDigits(jid) !== phone) {
      throw Object.assign(new Error('Número inválido.'), { statusCode: 400 });
    }

    const [check] = (await withRetry(() => sock.onWhatsApp(jid), 2)) ?? [];
    if (!check?.exists) {
      throw Object.assign(new Error('Este número não tem WhatsApp.'), { statusCode: 404 });
    }
    const target = check.jid || jid;

    const baseDelay = 1200 + Math.floor(Math.random() * 1800);
    const typingDelay = Math.min(baseDelay + text.length * 15, 6500);
    try {
      await sock.sendPresenceUpdate('composing', target);
      await sleep(typingDelay);
      await sock.sendPresenceUpdate('paused', target);
    } catch {
      /* presença é só cosmética */
    }
    await sleep(300 + Math.floor(Math.random() * 400));
    await sock.sendMessage(target, { text });
    console.log(`📤 Mensagem enviada para ${phone} (digitando ${typingDelay}ms)`);
  }

  /**
   * Busca os metadados do grupo direto no servidor. Lê duas vezes e só aceita quando as
   * duas leituras batem (mesmos participantes e mesmos números) — protege contra resposta
   * parcial ou o grupo mudando no meio da extração.
   */
  private async fetchStableMetadata(sock: WASocket, groupJid: string, warnings: string[]): Promise<GroupMetadata> {
    const fingerprint = (m: GroupMetadata) =>
      m.participants
        .map((p) => `${p.id}|${p.phoneNumber ?? ''}|${p.lid ?? ''}`)
        .sort()
        .join(',');

    let previous = await withRetry(() => sock.groupMetadata(groupJid));
    for (let i = 0; i < 3; i++) {
      await sleep(1200);
      const current = await withRetry(() => sock.groupMetadata(groupJid));
      if (fingerprint(current) === fingerprint(previous)) return current;
      previous = current;
    }
    warnings.push('A lista de membros mudou durante a extração (alguém entrou/saiu). Usada a leitura mais recente.');
    return previous;
  }

  /**
   * Confirma números no servidor: pergunta ao WhatsApp qual é o LID de cada telefone
   * e compara com o LID do participante no grupo. Se não bater → número descartado.
   */
  private async verifyAgainstServer(sock: WASocket, targets: MemberDTO[], warnings: string[]) {
    const pending = targets.filter((m) => m.phone && m.lid);
    let failedChunks = 0;

    for (let i = 0; i < pending.length; i += VERIFY_CHUNK) {
      const chunk = pending.slice(i, i + VERIFY_CHUNK);
      const serverLidByPhone = new Map<string, string>();
      let ok = false;

      try {
        const query = new USyncQuery().withLIDProtocol().withContext('background');
        for (const m of chunk) query.withUser(new USyncUser().withId(`${m.phone}@s.whatsapp.net`));
        const result = await withRetry(() => sock.executeUSyncQuery(query), 2);
        if (result) {
          ok = true;
          for (const item of result.list) {
            const phone = pnJidToDigits(item.id?.replace(/:\d+@/, '@'));
            const lid = typeof item.lid === 'string' ? jidUser(item.lid) : null;
            if (phone && lid) serverLidByPhone.set(phone, lid);
          }
        }
      } catch (err) {
        console.warn('Falha ao verificar lote no servidor:', (err as Error).message);
      }
      if (!ok) failedChunks++;

      for (const m of chunk) {
        const serverLid = serverLidByPhone.get(m.phone!);
        if (serverLid && serverLid === m.lid) {
          m.verified = true;
        } else if (serverLid && serverLid !== m.lid) {
          // O servidor diz que esse telefone pertence a OUTRA pessoa → número errado.
          discard(m, 'conflict');
        } else if (m.source === 'lid-cache') {
          // Cache local sem confirmação do servidor → não arrisca.
          discard(m, 'unverified');
        }
        // jid/server sem resposta: mantém (veio do próprio servidor), mas verified=false.
      }

      if (i + VERIFY_CHUNK < pending.length) await sleep(800);
    }

    if (failedChunks) {
      warnings.push(`${failedChunks} lote(s) de verificação não responderam; números do cache local nesses lotes foram descartados.`);
    }
  }

  /**
   * Lê os participantes do grupo, resolve o telefone de cada um com regras estritas,
   * confirma no servidor e salva JSON + CSV + TXT em /exports.
   * @param verifyAll também reconfirma números que já vieram do servidor (mais lento)
   */
  async extractMembers(groupJid: string, verifyAll = false): Promise<ExtractionDTO> {
    const sock = this.requireSocket();
    const warnings: string[] = [];

    const meta = await this.fetchStableMetadata(sock, groupJid, warnings);

    if (meta.size && meta.size !== meta.participants.length) {
      warnings.push(
        `O WhatsApp informa ${meta.size} membros, mas devolveu ${meta.participants.length} na lista.`,
      );
    }

    // Mapa local LID→telefone (só usado para LIDs sem phone_number; será confirmado no servidor).
    const lids = meta.participants.filter((p) => p.id.endsWith('@lid') && !p.phoneNumber).map((p) => p.id);
    const lidCache = new Map<string, string>();
    if (lids.length) {
      try {
        const mappings = await sock.signalRepository.lidMapping.getPNsForLIDs(lids);
        for (const m of mappings ?? []) {
          const lidUser = jidUser(m.lid);
          if (lidUser && m.pn.endsWith('@s.whatsapp.net')) lidCache.set(lidUser, m.pn);
        }
      } catch (err) {
        console.warn('Mapa LID local indisponível:', (err as Error).message);
      }
    }

    const members = resolveParticipants(meta.participants, {
      me: { id: sock.user?.id, lid: sock.user?.lid },
      lidCache,
      names: this.contacts,
    });

    const toVerify = members.filter((m) => m.source === 'lid-cache' || (verifyAll && m.source !== 'self'));
    if (toVerify.length) await this.verifyAgainstServer(sock, toVerify, warnings);

    // Admins primeiro, depois quem tem número, depois por número.
    const roleOrder = { superadmin: 0, admin: 1, member: 2 } as const;
    members.sort(
      (a, b) =>
        roleOrder[a.role] - roleOrder[b.role] ||
        Number(!a.phone) - Number(!b.phone) ||
        (a.phone ?? a.jid).localeCompare(b.phone ?? b.jid),
    );

    const extractedAt = new Date().toISOString();
    const base = `${slugify(meta.subject)}_${extractedAt.replace(/[:.]/g, '-').slice(0, 19)}`;
    const files = { json: `${base}.json`, csv: `${base}.csv`, txt: `${base}.txt` };

    const withPhone = members.filter((m) => m.phone);
    const result: ExtractionDTO = {
      group: {
        id: meta.id,
        name: meta.subject,
        description: meta.desc ?? null,
        size: meta.participants.length,
        addressingMode: String(meta.addressingMode ?? 'pn'),
      },
      extractedAt,
      totals: {
        members: members.length,
        withPhone: withPhone.length,
        hidden: members.length - withPhone.length,
        admins: members.filter((m) => m.role !== 'member').length,
        verified: members.filter((m) => m.verified).length,
        discarded: members.filter((m) => m.hiddenReason === 'conflict' || m.hiddenReason === 'unverified' || m.hiddenReason === 'invalid').length,
      },
      warnings,
      members,
      files,
    };

    // Checagem final de sanidade: nenhum número inválido ou repetido pode sair daqui.
    const seen = new Set<string>();
    for (const m of withPhone) {
      if (pnJidToDigits(`${m.phone}@s.whatsapp.net`) !== m.phone || seen.has(m.phone!)) {
        throw new Error(`Falha de integridade no número do participante ${m.jid}. Extração abortada.`);
      }
      seen.add(m.phone!);
    }

    // Primeira coluna é texto ("+55 11 ...") para o Excel não converter em 5,51E+12.
    const csv = [
      'telefone_formatado;telefone;nome;cargo;origem;verificado_no_servidor;motivo_sem_numero;lid;jid',
      ...members.map((m) =>
        [
          m.formatted,
          m.phone,
          m.name,
          m.role,
          m.source,
          m.verified ? 'sim' : 'nao',
          m.hiddenReason,
          m.lid,
          m.jid,
        ]
          .map(csvCell)
          .join(';'),
      ),
    ].join('\r\n');

    fs.writeFileSync(path.join(EXPORTS_DIR, files.json), JSON.stringify(result, null, 2), 'utf8');
    fs.writeFileSync(path.join(EXPORTS_DIR, files.csv), '﻿' + csv, 'utf8');
    fs.writeFileSync(path.join(EXPORTS_DIR, files.txt), withPhone.map((m) => m.phone).join('\r\n'), 'utf8');

    console.log(
      `📥 "${meta.subject}": ${result.totals.withPhone}/${result.totals.members} números (` +
        `${result.totals.verified} verificados, ${result.totals.discarded} descartados) → exports/${files.csv}`,
    );
    for (const w of warnings) console.warn(`   ⚠️ ${w}`);
    return result;
  }

  listExports(): ExportFileDTO[] {
    return fs
      .readdirSync(EXPORTS_DIR)
      .filter((f) => /\.(csv|json|txt)$/.test(f))
      .map((name) => {
        const stat = fs.statSync(path.join(EXPORTS_DIR, name));
        return { name, size: stat.size, createdAt: stat.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const whatsapp = new WhatsAppService();
