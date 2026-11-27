import makeWASocket, {
  Browsers,
  CacheStore,
  DisconnectReason,
  WASocket,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from '../config';
import { prisma } from '../db';
import { WhatsAppConnectionStatus, WhatsAppStatePayload } from '../types';
import { emitUserEvent, logActivity } from './activityLog';
import {
  analyzeImageWithAi,
  generateConversationReply,
  generateConversationSummary,
  transcribeAudioWithAi,
} from './aiService';
import { isUserAdmin, parsePermissions } from './authService';
import {
  evaluateBusinessHours,
  renderOffHoursMessage,
} from './businessHours';

const logger = pino({ level: 'silent' });

/**
 * Cache em memória com TTL e limite de entradas compatível com Baileys CacheStore
 * (evita condições de corrida no SignalKeyStore e rastreia retries de descriptografia).
 */
class MemoryCacheStore implements CacheStore {
  private store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly maxEntries = 2000
  ) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  flushAll(): void {
    this.store.clear();
  }
}

export type AiReplyQueueStatus =
  | 'RECEIVED_QUEUED'
  | 'PROCESSING'
  | 'RESPONDING'
  | 'RESPONDED'
  | 'FAILED';

export interface AiReplyQueueItem {
  conversationId: string;
  contactName: string;
  contactPhone: string;
  lastIncomingPreview: string;
  status: AiReplyQueueStatus;
  detail?: string;
  updatedAt: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function normalizePhoneAndJid(raw: string): {
  phone: string;
  jid: string;
} {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return {
    phone: digits,
    jid: `${digits}@s.whatsapp.net`,
  };
}

/**
 * Desembrulha mensagens encapsuladas pelo WhatsApp / WhatsApp Business
 * (Mensagens Temporárias / ephemeralMessage, visualização única, legendas de documentos, edições, etc.).
 */
function unwrapMessage(
  msg: proto.IMessage | null | undefined
): proto.IMessage | null | undefined {
  let current = msg;
  for (let depth = 0; depth < 6 && current; depth++) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
      continue;
    }
    if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
      continue;
    }
    if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
      continue;
    }
    if (current.viewOnceMessageV2Extension?.message) {
      current = current.viewOnceMessageV2Extension.message;
      continue;
    }
    if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
      continue;
    }
    if (current.editedMessage?.message) {
      current = current.editedMessage.message;
      continue;
    }
    if (current.deviceSentMessage?.message) {
      current = current.deviceSentMessage.message;
      continue;
    }
    break;
  }
  return current;
}

function extractTextFromMessage(msg: proto.IMessage | null | undefined): string {
  const m = unwrapMessage(msg);
  if (!m) return '';

  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return `[Imagem] ${m.imageMessage.caption}`;
  if (m.videoMessage) {
    return m.videoMessage.caption
      ? `[Vídeo] ${m.videoMessage.caption}`
      : '[Vídeo enviado]';
  }
  if (m.documentMessage) {
    const fileLabel = m.documentMessage.fileName || m.documentMessage.title || '';
    const cap = m.documentMessage.caption || '';
    if (cap) return `[Documento${fileLabel ? `: ${fileLabel}` : ''}] ${cap}`;
    return `[Documento${fileLabel ? `: ${fileLabel}` : ' enviado'}]`;
  }
  if (m.stickerMessage) return '[Figurinha enviada]';
  if (m.contactMessage) {
    return `[Contato compartilhado: ${m.contactMessage.displayName || 'Contato'}]`;
  }
  if (m.locationMessage) {
    const loc = [m.locationMessage.name, m.locationMessage.address]
      .filter(Boolean)
      .join(' - ');
    return loc ? `[Localização: ${loc}]` : '[Localização enviada]';
  }

  // Mensagens do WhatsApp Business (templates, botões, listas e mensagens interativas)
  if (m.buttonsMessage) {
    return [m.buttonsMessage.contentText, m.buttonsMessage.footerText]
      .filter(Boolean)
      .join('\n');
  }
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText;
  }
  if (m.listMessage) {
    return [m.listMessage.title, m.listMessage.description, m.listMessage.footerText]
      .filter(Boolean)
      .join('\n');
  }
  if (m.listResponseMessage) {
    return [
      m.listResponseMessage.title,
      m.listResponseMessage.description,
    ]
      .filter(Boolean)
      .join(' - ');
  }
  if (m.templateMessage) {
    const hydrated =
      m.templateMessage.hydratedTemplate ||
      m.templateMessage.hydratedFourRowTemplate;
    if (hydrated) {
      return [
        hydrated.hydratedTitleText,
        hydrated.hydratedContentText,
        hydrated.hydratedFooterText,
      ]
        .filter(Boolean)
        .join('\n');
    }
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText;
  }
  if (m.interactiveMessage) {
    return [
      m.interactiveMessage.header?.title,
      m.interactiveMessage.body?.text,
      m.interactiveMessage.footer?.text,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (m.interactiveResponseMessage?.body?.text) {
    return m.interactiveResponseMessage.body.text;
  }
  if (m.pollCreationMessage?.name) {
    return `[Enquete] ${m.pollCreationMessage.name}`;
  }
  if (m.pollCreationMessageV3?.name) {
    return `[Enquete] ${m.pollCreationMessageV3.name}`;
  }

  return '';
}

class UserWhatsAppSession {
  private readonly userId: string;
  private readonly sessionPath: string;
  private sock: WASocket | null = null;
  private status: WhatsAppConnectionStatus = 'DISCONNECTED';
  private connectedPhone: string | null = null;
  private connectedName: string | null = null;
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private campaignRunning = false;
  private pendingAiTimers = new Map<string, NodeJS.Timeout>();
  private replyQueue = new Map<string, AiReplyQueueItem>();
  private lastOffHoursNoticeAt = new Map<string, number>();
  private msgRetryCounterCache = new MemoryCacheStore(15 * 60 * 1000, 1000);
  private userDevicesCache = new MemoryCacheStore(60 * 60 * 1000, 1000);
  private signalKeyCache = new MemoryCacheStore(60 * 60 * 1000, 3000);
  private sentMessageCache = new Map<string, proto.IMessage>();

  constructor(userId: string) {
    this.userId = userId;
    this.sessionPath = path.join(config.sessionDir, userId);
  }

  private rememberSentMessage(
    waMessageId: string | null | undefined,
    message: proto.IMessage | null | undefined
  ): void {
    if (!waMessageId || !message) return;
    if (this.sentMessageCache.size >= 500 && !this.sentMessageCache.has(waMessageId)) {
      const oldest = this.sentMessageCache.keys().next().value;
      if (oldest !== undefined) {
        this.sentMessageCache.delete(oldest);
      }
    }
    this.sentMessageCache.set(waMessageId, message);
  }

  private async lookupMessageForRetry(
    key: proto.IMessageKey
  ): Promise<proto.IMessage | undefined> {
    const waId = key.id;
    if (!waId) return undefined;

    const cached = this.sentMessageCache.get(waId);
    if (cached) return cached;

    try {
      const found = await prisma.message.findFirst({
        where: {
          waMessageId: waId,
          conversation: { userId: this.userId },
        },
        select: { body: true },
      });
      if (found?.body) {
        return { conversation: found.body };
      }
    } catch {
      // fallback silencioso
    }
    return undefined;
  }

  public shutdownGracefully(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const timer of this.pendingAiTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingAiTimers.clear();
    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {
        // ignora erro ao encerrar socket
      }
      this.sock = null;
    }
    this.status = 'DISCONNECTED';
  }

  public getReplyQueue(): AiReplyQueueItem[] {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [key, item] of this.replyQueue.entries()) {
      if (
        (item.status === 'RESPONDED' || item.status === 'FAILED') &&
        new Date(item.updatedAt).getTime() < cutoff
      ) {
        this.replyQueue.delete(key);
      }
    }

    const priority: Record<AiReplyQueueStatus, number> = {
      RESPONDING: 0,
      PROCESSING: 1,
      RECEIVED_QUEUED: 2,
      FAILED: 3,
      RESPONDED: 4,
    };

    return Array.from(this.replyQueue.values())
      .sort((a, b) => {
        const diff = priority[a.status] - priority[b.status];
        if (diff !== 0) return diff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, 15);
  }

  public clearCompletedReplyQueue(): AiReplyQueueItem[] {
    for (const [key, item] of this.replyQueue.entries()) {
      if (item.status === 'RESPONDED' || item.status === 'FAILED') {
        this.replyQueue.delete(key);
      }
    }
    const list = this.getReplyQueue();
    emitUserEvent(this.userId, 'ai:reply-queue', list);
    return list;
  }

  private setReplyQueueItem(item: AiReplyQueueItem): void {
    this.replyQueue.set(item.conversationId, item);
    if (this.replyQueue.size > 25) {
      const oldest = Array.from(this.replyQueue.values())
        .filter((i) => i.status === 'RESPONDED' || i.status === 'FAILED')
        .sort(
          (a, b) =>
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        )[0];
      if (oldest) {
        this.replyQueue.delete(oldest.conversationId);
      }
    }
    emitUserEvent(this.userId, 'ai:reply-queue', this.getReplyQueue());
  }

  private removeReplyQueueItem(conversationId: string): void {
    if (this.replyQueue.delete(conversationId)) {
      emitUserEvent(this.userId, 'ai:reply-queue', this.getReplyQueue());
    }
  }

  public hasSavedSession(): boolean {
    try {
      return (
        fs.existsSync(this.sessionPath) &&
        fs.existsSync(path.join(this.sessionPath, 'creds.json'))
      );
    } catch {
      return false;
    }
  }

  public setCampaignRunning(running: boolean): void {
    this.campaignRunning = running;
    void this.broadcastStatus();
  }

  public isConnected(): boolean {
    return this.status === 'CONNECTED' && this.sock !== null;
  }

  public getQuickStatus(): {
    status: WhatsAppConnectionStatus;
    connectedPhone: string | null;
  } {
    const effectiveStatus: WhatsAppConnectionStatus =
      this.status === 'CONNECTED' && this.campaignRunning
        ? 'CAMPAIGN_RUNNING'
        : this.status;
    return {
      status: effectiveStatus,
      connectedPhone: this.connectedPhone,
    };
  }

  public async getState(): Promise<WhatsAppStatePayload> {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: this.userId },
    });
    const effectiveStatus: WhatsAppConnectionStatus =
      this.status === 'CONNECTED' && this.campaignRunning
        ? 'CAMPAIGN_RUNNING'
        : this.status;

    return {
      status: effectiveStatus,
      connectedPhone: this.connectedPhone,
      connectedName: this.connectedName,
      qrDataUrl: this.qrDataUrl,
      globalAutomationPaused: settings?.globalAutomationPaused ?? false,
      hasSavedSession: this.hasSavedSession(),
      lastError: this.lastError,
    };
  }

  public async broadcastStatus(): Promise<void> {
    const state = await this.getState();
    emitUserEvent(this.userId, 'whatsapp:status', state);
  }

  public async connect(): Promise<void> {
    if (this.isConnecting || this.status === 'CONNECTED') {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;
    this.lastError = null;

    try {
      fs.mkdirSync(this.sessionPath, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

      let version: [number, number, number] = [2, 3000, 1023223821];
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        // Fallback seguro
      }

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          // Usa o NodeCache nativo do Baileys (TTL curto de 5 min) para nunca reter chaves Signal obsoletas
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('ZapFlow AI'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        msgRetryCounterCache: this.msgRetryCounterCache,
        userDevicesCache: this.userDevicesCache,
        maxMsgRetryCount: 5,
        retryRequestDelayMs: 350,
        getMessage: (key) => this.lookupMessageForRetry(key),
      });

      this.sock = sock;

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'AWAITING_QR';
          this.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 300,
            margin: 2,
          });
          emitUserEvent(this.userId, 'whatsapp:qr', {
            qrDataUrl: this.qrDataUrl,
          });
          await this.broadcastStatus();
          await logActivity(
            this.userId,
            'WHATSAPP',
            'Novo QR Code gerado. Escaneie no WhatsApp em "Dispositivos Conectados".',
            'INFO'
          );
        }

        if (connection === 'open') {
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.status = 'CONNECTED';
          this.qrDataUrl = null;
          this.lastError = null;
          const rawId = sock.user?.id || '';
          this.connectedPhone = rawId.split(':')[0]?.split('@')[0] || null;
          this.connectedName = sock.user?.name || 'Dispositivo Conectado';

          emitUserEvent(this.userId, 'whatsapp:qr', { qrDataUrl: null });
          await this.broadcastStatus();
          await logActivity(
            this.userId,
            'WHATSAPP',
            `WhatsApp conectado com sucesso (${this.connectedPhone || 'ativo'}).`,
            'SUCCESS'
          );
        }

        if (connection === 'close') {
          this.isConnecting = false;
          this.sock = null;
          this.qrDataUrl = null;

          const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
            ?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const replaced = statusCode === DisconnectReason.connectionReplaced;

          this.status = 'DISCONNECTED';

          if (loggedOut) {
            this.connectedPhone = null;
            this.connectedName = null;
            this.lastError =
              'Sessão desconectada pelo celular. Limpe a sessão e escaneie um novo QR Code.';
            this.shouldReconnect = false;
            await this.clearSessionFiles();
            await logActivity(this.userId, 'WHATSAPP', this.lastError, 'WARN');
          } else if (replaced) {
            // Outra instância assumiu temporariamente a sessão (ex: redeploy) — não briga pela conexão
            this.shouldReconnect = false;
            this.lastError =
              'Conexão substituída por outra instância ativa. Se necessário, clique em Conectar.';
            await logActivity(this.userId, 'WHATSAPP', this.lastError, 'WARN');
          } else if (this.shouldReconnect) {
            this.reconnectAttempts += 1;
            const delayMs = Math.min(3000 * this.reconnectAttempts, 30000);
            this.lastError = `Conexão interrompida (código ${statusCode ?? 'desconhecido'}). Reconectando em ${Math.round(
              delayMs / 1000
            )}s...`;
            await logActivity(this.userId, 'WHATSAPP', this.lastError, 'WARN');

            this.reconnectTimer = setTimeout(() => {
              void this.connect();
            }, delayMs);
          } else {
            await logActivity(this.userId, 'WHATSAPP', 'WhatsApp desconectado.', 'INFO');
          }

          await this.broadcastStatus();
        }
      });

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
          await this.handleIncomingMessage(msg);
        }
      });
    } catch (err) {
      this.isConnecting = false;
      this.status = 'DISCONNECTED';
      this.lastError =
        err instanceof Error ? err.message : 'Erro ao inicializar conexão Baileys.';
      await logActivity(this.userId, 'WHATSAPP', this.lastError, 'ERROR');
      await this.broadcastStatus();
    }
  }

  public async disconnect(clearSession = false): Promise<void> {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        if (clearSession) {
          await this.sock.logout();
        } else {
          this.sock.end(new Error('Desconectado pelo usuário'));
        }
      } catch {
        // Ignora erro se socket já estiver fechado
      }
      this.sock = null;
    }

    if (clearSession) {
      await this.clearSessionFiles();
    }

    this.status = 'DISCONNECTED';
    this.isConnecting = false;
    this.qrDataUrl = null;
    this.connectedPhone = null;
    this.connectedName = null;
    this.lastError = null;

    emitUserEvent(this.userId, 'whatsapp:qr', { qrDataUrl: null });
    await this.broadcastStatus();
    await logActivity(
      this.userId,
      'WHATSAPP',
      clearSession
        ? 'Sessão encerrada e credenciais locais removidas.'
        : 'Conexão encerrada (sessão local preservada).',
      'INFO'
    );
  }

  /**
   * Repara sessões de criptografia Signal corrompidas (Bad MAC / "Aguardando mensagem...")
   * removendo apenas arquivos session-*.json e sender-key-*.json — preservando creds.json
   * para reconectar automaticamente SEM precisar escanear QR Code novamente.
   */
  public async repairEncryptionSessions(): Promise<{ removedFiles: number }> {
    const hadSession = this.hasSavedSession();
    await this.disconnect(false);

    this.signalKeyCache.flushAll();
    this.msgRetryCounterCache.flushAll();
    this.userDevicesCache.flushAll();

    let removedFiles = 0;
    try {
      if (fs.existsSync(this.sessionPath)) {
        const files = fs.readdirSync(this.sessionPath);
        for (const file of files) {
          if (
            file.startsWith('session-') ||
            file.startsWith('sender-key-') ||
            file.startsWith('sender-key-memory-')
          ) {
            try {
              fs.rmSync(path.join(this.sessionPath, file), { force: true });
              removedFiles++;
            } catch {
              // ignora falha individual
            }
          }
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao reparar sessões Signal:', err);
    }

    await logActivity(
      this.userId,
      'WHATSAPP',
      `Reparo de criptografia Signal executado (${removedFiles} chave(s) de sessão renovada(s) sem perder login). Reconectando...`,
      'SUCCESS'
    );

    if (hadSession) {
      void this.connect();
    }

    return { removedFiles };
  }

  private async clearSessionFiles(): Promise<void> {
    this.signalKeyCache.flushAll();
    this.msgRetryCounterCache.flushAll();
    this.userDevicesCache.flushAll();
    this.sentMessageCache.clear();
    try {
      if (fs.existsSync(this.sessionPath)) {
        fs.rmSync(this.sessionPath, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao limpar sessão do usuário:', err);
    }
  }

  public async simulateTypingAndSend(
    jid: string,
    text: string,
    simulateTyping = true
  ): Promise<string | null> {
    if (!this.sock || this.status !== 'CONNECTED') {
      throw new Error('WhatsApp não está conectado.');
    }

    if (simulateTyping) {
      try {
        // Timeout de segurança para presenceSubscribe nunca travar envio em contas Business/@lid
        await Promise.race([
          (async () => {
            await this.sock!.presenceSubscribe(jid);
            await this.sock!.sendPresenceUpdate('composing', jid);
          })(),
          sleep(2000),
        ]);
        const typingMs = randomInt(3000, 7000);
        await sleep(typingMs);
        await Promise.race([
          this.sock.sendPresenceUpdate('paused', jid),
          sleep(1500),
        ]);
      } catch {
        // Best-effort
      }
    }

    const sent = await this.sock.sendMessage(jid, { text });
    const sentId = sent?.key?.id || null;
    this.rememberSentMessage(sentId, sent?.message || { conversation: text });
    return sentId;
  }

  public async sendManualMessage(
    conversationId: string,
    body: string
  ): Promise<{
    message: Awaited<ReturnType<typeof prisma.message.create>>;
    autoPausedAi: boolean;
  }> {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: this.userId },
      include: { contact: true },
    });

    if (!conversation) {
      throw new Error('Conversa não encontrada.');
    }

    const targetJid = conversation.contact.replyJid || conversation.contact.jid;
    const waMessageId = await this.simulateTypingAndSend(
      targetJid,
      body,
      false
    );

    const message = await prisma.message.create({
      data: {
        conversationId: conversation.id,
        waMessageId: waMessageId || undefined,
        direction: 'OUTBOUND',
        senderType: 'HUMAN',
        body,
        status: 'SENT',
      },
    });

    const settings = await prisma.userSettings.findUnique({
      where: { userId: this.userId },
    });
    let autoPausedAi = false;

    const updateData: {
      lastMessageAt: Date;
      lastMessagePreview: string;
      unreadCount: number;
      needsHumanAttention: boolean;
      humanAttentionReason: null;
      humanAttentionAt: null;
      mode?: string;
    } = {
      lastMessageAt: new Date(),
      lastMessagePreview: body.slice(0, 120),
      unreadCount: 0,
      needsHumanAttention: false,
      humanAttentionReason: null,
      humanAttentionAt: null,
    };

    if (settings?.autoPauseOnManualSend && conversation.mode === 'AUTO') {
      updateData.mode = 'MANUAL';
      autoPausedAi = true;
    }

    const updatedConv = await prisma.conversation.update({
      where: { id: conversation.id },
      data: updateData,
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        activeRule: true,
      },
    });

    emitUserEvent(this.userId, 'message:new', message);
    emitUserEvent(this.userId, 'conversation:updated', updatedConv);
    emitUserEvent(this.userId, 'dashboard:refresh', {});

    await logActivity(
      this.userId,
      'WHATSAPP',
      `Mensagem manual enviada para ${conversation.contact.name || conversation.contact.phone}${
        autoPausedAi ? ' (IA pausada automaticamente neste chat)' : ''
      }.`,
      'INFO'
    );

    return { message, autoPausedAi };
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    try {
      const rawRemoteJid = msg.key?.remoteJid;
      if (!rawRemoteJid) return;
      if (msg.key.fromMe) return;
      if (rawRemoteJid === 'status@broadcast' || rawRemoteJid.endsWith('@g.us')) {
        return;
      }

      // Resolve JID real em contas Business/multi-device que enviam @lid com remoteJidAlt/senderPn
      const keyAny = msg.key as unknown as {
        remoteJidAlt?: string;
        senderPn?: string;
      };
      let remoteJid = rawRemoteJid;
      if (rawRemoteJid.endsWith('@lid')) {
        const alt = keyAny.remoteJidAlt || keyAny.senderPn;
        if (alt && alt.endsWith('@s.whatsapp.net')) {
          remoteJid = alt;
        }
      }

      const unwrapped = unwrapMessage(msg.message);
      const imageMsg = unwrapped?.imageMessage;
      const audioMsg = unwrapped?.audioMessage;
      const caption = imageMsg?.caption?.trim() || '';
      let body = extractTextFromMessage(unwrapped).trim();
      let mediaType: string | null = null;
      let imageAnalysis: string | null = null;
      let audioTranscript: string | null = null;

      if (imageMsg) {
        mediaType = 'image';
        if (!body) {
          body = caption ? `[Imagem] ${caption}` : '[Imagem enviada]';
        }
      } else if (audioMsg) {
        mediaType = 'audio';
        const secs = audioMsg.seconds ? ` (${audioMsg.seconds}s)` : '';
        body = audioMsg.ptt
          ? `[Mensagem de voz${secs}]`
          : `[Áudio enviado${secs}]`;
      }

      if (!body) {
        const keys = Object.keys(msg.message || {}).filter(
          (k) =>
            k !== 'messageContextInfo' &&
            k !== 'senderKeyDistributionMessage' &&
            k !== 'protocolMessage' &&
            k !== 'reactionMessage'
        );
        if (keys.length > 0) {
          console.log(
            `[WhatsApp] Mensagem ignorada de ${remoteJid} (tipos não textuais: ${keys.join(', ')})`
          );
        }
        return;
      }

      const [settings, userMeta] = await Promise.all([
        prisma.userSettings.findUnique({ where: { userId: this.userId } }),
        prisma.user.findUnique({
          where: { id: this.userId },
          select: { isOwner: true, role: true, permissionsJson: true },
        }),
      ]);
      const userPerms =
        userMeta && isUserAdmin({ isOwner: userMeta.isOwner, role: (userMeta.role as 'ADMIN' | 'USER') || 'USER' })
          ? { vision: true, audio: true }
          : parsePermissions(userMeta?.permissionsJson);

      const phone = remoteJid.split('@')[0].replace(/\D/g, '');
      const pushName = msg.pushName?.trim() || null;

      // Se o módulo de leitura de imagens estiver ativo e permitido para este usuário, analisa com IA multimodal
      if (imageMsg && settings?.enableImageReading && userPerms.vision) {
        try {
          const mediaBuffer = (await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
              logger,
              reuploadRequest: this.sock!.updateMediaMessage,
            }
          )) as Buffer;

          const maxBytes = 6 * 1024 * 1024; // Limite de 6MB por segurança
          if (mediaBuffer && mediaBuffer.length > 0 && mediaBuffer.length <= maxBytes) {
            const mimeType = imageMsg.mimetype || 'image/jpeg';
            const vision = await analyzeImageWithAi(
              this.userId,
              mediaBuffer.toString('base64'),
              mimeType,
              caption || undefined
            );
            imageAnalysis = vision.description;
            await logActivity(
              this.userId,
              'AI',
              `Imagem recebida de ${pushName || phone} analisada com sucesso (${vision.modelUsed}).`,
              'SUCCESS'
            );
          } else if (mediaBuffer && mediaBuffer.length > maxBytes) {
            await logActivity(
              this.userId,
              'AI',
              `Imagem de ${pushName || phone} excedeu 6MB e foi ignorada na leitura de visão.`,
              'WARN'
            );
          }
        } catch (visionErr) {
          await logActivity(
            this.userId,
            'AI',
            `Falha ao ler imagem de ${pushName || phone}: ${
              visionErr instanceof Error ? visionErr.message : 'erro desconhecido'
            }`,
            'ERROR'
          );
        }
      }

      // Se o módulo de transcrição de áudio estiver ativo e permitido para este usuário, transcreve com Gemini multimodal
      if (audioMsg && settings?.enableAudioTranscription && userPerms.audio) {
        try {
          const mediaBuffer = (await downloadMediaMessage(
            msg,
            'buffer',
            {},
            {
              logger,
              reuploadRequest: this.sock!.updateMediaMessage,
            }
          )) as Buffer;

          const maxAudioBytes = 10 * 1024 * 1024; // Limite de 10MB (~15-20 min OGG Opus)
          if (
            mediaBuffer &&
            mediaBuffer.length > 0 &&
            mediaBuffer.length <= maxAudioBytes
          ) {
            const mimeType = audioMsg.mimetype || 'audio/ogg';
            const result = await transcribeAudioWithAi(
              this.userId,
              mediaBuffer.toString('base64'),
              mimeType
            );
            audioTranscript = result.transcript;
            await logActivity(
              this.userId,
              'AI',
              `Áudio recebido de ${pushName || phone} transcrito com sucesso (${result.modelUsed}).`,
              'SUCCESS'
            );
          } else if (mediaBuffer && mediaBuffer.length > maxAudioBytes) {
            await logActivity(
              this.userId,
              'AI',
              `Áudio de ${pushName || phone} excedeu 10MB e não foi transcrito.`,
              'WARN'
            );
          }
        } catch (audioErr) {
          await logActivity(
            this.userId,
            'AI',
            `Falha ao transcrever áudio de ${pushName || phone}: ${
              audioErr instanceof Error ? audioErr.message : 'erro desconhecido'
            }`,
            'ERROR'
          );
        }
      }

      // Preserva rawRemoteJid (incluindo @lid) como replyJid para manter as chaves Signal
      // sincronizadas ao responder, evitando Bad MAC / "Aguardando mensagem..." no cliente.
      const contact = await prisma.contact.upsert({
        where: { userId_jid: { userId: this.userId, jid: remoteJid } },
        update: {
          ...(pushName ? { name: pushName } : {}),
          replyJid: rawRemoteJid,
        },
        create: {
          userId: this.userId,
          phone,
          jid: remoteJid,
          replyJid: rawRemoteJid,
          name: pushName,
        },
      });

      const conversation = await prisma.conversation.upsert({
        where: { contactId: contact.id },
        update: {
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 120),
          unreadCount: { increment: 1 },
        },
        create: {
          userId: this.userId,
          contactId: contact.id,
          mode: 'AUTO',
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 120),
          unreadCount: 1,
        },
        include: {
          contact: { include: { tags: { include: { tag: true } } } },
          activeRule: true,
        },
      });

      const waMessageId = msg.key.id || undefined;
      if (waMessageId) {
        const exists = await prisma.message.findUnique({
          where: {
            conversationId_waMessageId: {
              conversationId: conversation.id,
              waMessageId,
            },
          },
        });
        if (exists) return;
      }

      const savedMsg = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          waMessageId,
          direction: 'INBOUND',
          senderType: 'CONTACT',
          body,
          mediaType,
          imageAnalysis,
          audioTranscript,
          status: 'DELIVERED',
        },
      });

      emitUserEvent(this.userId, 'message:new', savedMsg);
      emitUserEvent(this.userId, 'conversation:updated', conversation);
      emitUserEvent(this.userId, 'dashboard:refresh', {});

      const contactLabel = contact.name || contact.phone;
      await logActivity(
        this.userId,
        'WHATSAPP',
        `${imageMsg ? 'Imagem' : audioMsg ? 'Áudio' : 'Mensagem'} recebido(a) de ${contactLabel}.`,
        'INFO'
      );

      if (settings?.globalAutomationPaused) {
        await logActivity(
          this.userId,
          'AI',
          `Automação global pausada — IA não respondeu ${contactLabel}.`,
          'WARN'
        );
        return;
      }

      if (conversation.mode !== 'AUTO') {
        await logActivity(
          this.userId,
          'AI',
          `Chat com ${contactLabel} está em modo Manual — aguardando resposta humana.`,
          'INFO'
        );
        return;
      }

      // Controle de Horário de Trabalho (Horário Comercial ou Atendimento Inverso)
      const bh = evaluateBusinessHours(settings);
      if (bh.enabled && !bh.aiAllowedNow) {
        if (bh.offHoursAction === 'SEND_MESSAGE' && bh.offHoursMessage.trim()) {
          const lastSentMs = this.lastOffHoursNoticeAt.get(conversation.id) || 0;
          const cooldownMs = bh.offHoursCooldownMin * 60 * 1000;
          if (Date.now() - lastSentMs >= cooldownMs) {
            this.lastOffHoursNoticeAt.set(conversation.id, Date.now());
            const noticeText = renderOffHoursMessage(
              bh.offHoursMessage,
              contact.name
            );
            try {
              const targetJid = contact.replyJid || contact.jid;
              const waNoticeId = await this.simulateTypingAndSend(
                targetJid,
                noticeText,
                true
              );
              const savedNotice = await prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  waMessageId: waNoticeId || undefined,
                  direction: 'OUTBOUND',
                  senderType: 'AI',
                  body: noticeText,
                  status: 'SENT',
                },
              });
              const updatedNoticeConv = await prisma.conversation.update({
                where: { id: conversation.id },
                data: {
                  lastMessageAt: new Date(),
                  lastMessagePreview: noticeText.slice(0, 120),
                },
                include: {
                  contact: { include: { tags: { include: { tag: true } } } },
                  activeRule: true,
                },
              });
              emitUserEvent(this.userId, 'message:new', savedNotice);
              emitUserEvent(this.userId, 'conversation:updated', updatedNoticeConv);
              emitUserEvent(this.userId, 'dashboard:refresh', {});
              await logActivity(
                this.userId,
                'AI',
                `Aviso de fora do horário (${bh.currentLocalTime}) enviado para ${contactLabel}.`,
                'INFO'
              );
            } catch (noticeErr) {
              await logActivity(
                this.userId,
                'AI',
                `Falha ao enviar aviso de fora do horário para ${contactLabel}: ${
                  noticeErr instanceof Error ? noticeErr.message : 'erro desconhecido'
                }`,
                'ERROR'
              );
            }
          } else {
            await logActivity(
              this.userId,
              'AI',
              `Fora do horário (${bh.currentLocalTime}) — aviso já enviado recentemente para ${contactLabel} (cooldown ${bh.offHoursCooldownMin} min).`,
              'INFO'
            );
          }
        } else {
          await logActivity(
            this.userId,
            'AI',
            `Fora do horário de trabalho (${bh.currentLocalTime}) — IA pausada para ${contactLabel}.`,
            'WARN'
          );
        }
        return;
      }

      const existingTimer = this.pendingAiTimers.get(conversation.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      this.setReplyQueueItem({
        conversationId: conversation.id,
        contactName: contactLabel,
        contactPhone: contact.phone,
        lastIncomingPreview: body.slice(0, 80),
        status: 'RECEIVED_QUEUED',
        detail: 'Mensagem recebida — na fila de processamento',
        updatedAt: new Date().toISOString(),
      });

      const timer = setTimeout(() => {
        this.pendingAiTimers.delete(conversation.id);
        void this.respondWithAi(
          conversation.id,
          contact.replyJid || contact.jid,
          contactLabel,
          contact.phone,
          body.slice(0, 80)
        );
      }, 2500);

      this.pendingAiTimers.set(conversation.id, timer);
    } catch (err) {
      console.error('[WhatsApp] Erro ao processar mensagem recebida:', err);
      await logActivity(
        this.userId,
        'WHATSAPP',
        `Erro ao processar mensagem recebida: ${
          err instanceof Error ? err.message : 'desconhecido'
        }`,
        'ERROR'
      );
    }
  }

  public async triggerAiReplyNow(conversationId: string): Promise<{
    message: Awaited<ReturnType<typeof prisma.message.create>>;
    ruleName: string;
    ruleLevel: string;
  }> {
    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: this.userId },
      include: { contact: true },
    });
    if (!conv) {
      throw new Error('Conversa não encontrada.');
    }
    const contactLabel = conv.contact.name || conv.contact.phone;
    const preview = conv.lastMessagePreview || 'Resposta acionada manualmente';

    try {
      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: conv.contact.phone,
        lastIncomingPreview: preview,
        status: 'PROCESSING',
        detail: 'Analisando últimos 20 min e gerando resposta...',
        updatedAt: new Date().toISOString(),
      });

      const reply = await generateConversationReply(this.userId, conversationId);

      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: conv.contact.phone,
        lastIncomingPreview: preview,
        status: 'RESPONDING',
        detail: 'Digitando e enviando resposta no WhatsApp...',
        updatedAt: new Date().toISOString(),
      });

      const waMessageId = await this.simulateTypingAndSend(
        conv.contact.replyJid || conv.contact.jid,
        reply.text,
        true
      );

      const savedOut = await prisma.message.create({
        data: {
          conversationId,
          waMessageId: waMessageId || undefined,
          direction: 'OUTBOUND',
          senderType: 'AI',
          body: reply.text,
          status: 'SENT',
        },
      });

      const updatedConv = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: reply.text.slice(0, 120),
          ...(reply.shouldTransferToHuman
            ? {
                mode: 'MANUAL',
                needsHumanAttention: true,
                humanAttentionAt: new Date(),
                humanAttentionReason: `Regra "${reply.ruleName}" redirecionou para atendimento humano.`,
              }
            : {}),
        },
        include: {
          contact: { include: { tags: { include: { tag: true } } } },
          activeRule: true,
        },
      });

      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: conv.contact.phone,
        lastIncomingPreview: preview,
        status: 'RESPONDED',
        detail: reply.shouldTransferToHuman
          ? 'Respondido • Redirecionado p/ Humano'
          : `Respondido (${reply.ruleName})`,
        updatedAt: new Date().toISOString(),
      });

      emitUserEvent(this.userId, 'message:new', savedOut);
      emitUserEvent(this.userId, 'conversation:updated', updatedConv);
      emitUserEvent(this.userId, 'dashboard:refresh', {});

      await logActivity(
        this.userId,
        'AI',
        `IA respondeu ${contactLabel} (Regra ${reply.ruleLevel}: ${reply.ruleName}).`,
        'SUCCESS'
      );

      if (reply.shouldTransferToHuman) {
        await logActivity(
          this.userId,
          'AI',
          `Condição de parada atingida para ${contactLabel}. Alerta de atenção humana ativado no Painel.`,
          'WARN'
        );
      }

      return {
        message: savedOut,
        ruleName: reply.ruleName,
        ruleLevel: reply.ruleLevel,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Erro desconhecido';
      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: conv.contact.phone,
        lastIncomingPreview: preview,
        status: 'FAILED',
        detail: errMsg.slice(0, 120),
        updatedAt: new Date().toISOString(),
      });
      throw err;
    }
  }

  private async respondWithAi(
    conversationId: string,
    jid: string,
    contactLabel: string,
    contactPhone = '',
    lastIncomingPreview = ''
  ): Promise<void> {
    try {
      const [settings, conv] = await Promise.all([
        prisma.userSettings.findUnique({ where: { userId: this.userId } }),
        prisma.conversation.findFirst({
          where: { id: conversationId, userId: this.userId },
          include: { contact: true },
        }),
      ]);

      const phone = contactPhone || conv?.contact.phone || '';
      const preview = lastIncomingPreview || conv?.lastMessagePreview || '';

      const bhCheck = evaluateBusinessHours(settings);
      if (
        !conv ||
        conv.mode !== 'AUTO' ||
        settings?.globalAutomationPaused ||
        (bhCheck.enabled && !bhCheck.aiAllowedNow)
      ) {
        console.log(
          `[WhatsApp][AI] Ignorando resposta para ${contactLabel} (mode=${conv?.mode}, globalPaused=${settings?.globalAutomationPaused}, bhAllowed=${bhCheck.aiAllowedNow})`
        );
        this.removeReplyQueueItem(conversationId);
        return;
      }

      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: phone,
        lastIncomingPreview: preview,
        status: 'PROCESSING',
        detail: 'Analisando últimos 20 min e gerando resposta...',
        updatedAt: new Date().toISOString(),
      });

      const reply = await generateConversationReply(this.userId, conversationId);

      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: phone,
        lastIncomingPreview: preview,
        status: 'RESPONDING',
        detail: 'Digitando e enviando resposta no WhatsApp...',
        updatedAt: new Date().toISOString(),
      });

      const targetJid = conv.contact.replyJid || jid || conv.contact.jid;
      const waMessageId = await this.simulateTypingAndSend(
        targetJid,
        reply.text,
        true
      );

      const savedOut = await prisma.message.create({
        data: {
          conversationId,
          waMessageId: waMessageId || undefined,
          direction: 'OUTBOUND',
          senderType: 'AI',
          body: reply.text,
          status: 'SENT',
        },
      });

      const updatedConv = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: reply.text.slice(0, 120),
          ...(reply.shouldTransferToHuman
            ? {
                mode: 'MANUAL',
                needsHumanAttention: true,
                humanAttentionAt: new Date(),
                humanAttentionReason: `Regra "${reply.ruleName}" redirecionou para atendimento humano.`,
              }
            : {}),
        },
        include: {
          contact: { include: { tags: { include: { tag: true } } } },
          activeRule: true,
        },
      });

      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: phone,
        lastIncomingPreview: preview,
        status: 'RESPONDED',
        detail: reply.shouldTransferToHuman
          ? 'Respondido • Redirecionado p/ Humano'
          : `Respondido (${reply.ruleName})`,
        updatedAt: new Date().toISOString(),
      });

      emitUserEvent(this.userId, 'message:new', savedOut);
      emitUserEvent(this.userId, 'conversation:updated', updatedConv);
      emitUserEvent(this.userId, 'dashboard:refresh', {});

      await logActivity(
        this.userId,
        'AI',
        `IA respondeu ${contactLabel} (Regra ${reply.ruleLevel}: ${reply.ruleName}).`,
        'SUCCESS'
      );

      if (reply.shouldTransferToHuman) {
        await logActivity(
          this.userId,
          'AI',
          `Condição de parada atingida para ${contactLabel}. Conversa transferida para modo Manual com alerta no Painel.`,
          'WARN'
        );
      }

      if (settings?.autoSummarizeConversations) {
        void generateConversationSummary(this.userId, conversationId).catch(
          () => {}
        );
      }
    } catch (err) {
      const errMsg =
        err instanceof Error ? err.message : 'Erro desconhecido';
      this.setReplyQueueItem({
        conversationId,
        contactName: contactLabel,
        contactPhone: contactPhone || '',
        lastIncomingPreview: lastIncomingPreview || '',
        status: 'FAILED',
        detail: errMsg.slice(0, 120),
        updatedAt: new Date().toISOString(),
      });
      console.error(
        `[WhatsApp][AI] Falha na resposta da IA para ${contactLabel} (${jid}):`,
        errMsg
      );
      await logActivity(
        this.userId,
        'AI',
        `Falha na resposta da IA para ${contactLabel}: ${errMsg}`,
        'ERROR'
      );
    }
  }
}

class WhatsAppManager {
  private sessions = new Map<string, UserWhatsAppSession>();

  public getSession(userId: string): UserWhatsAppSession {
    let session = this.sessions.get(userId);
    if (!session) {
      session = new UserWhatsAppSession(userId);
      this.sessions.set(userId, session);
    }
    return session;
  }

  public getSessionQuickStatus(userId: string): {
    status: WhatsAppConnectionStatus;
    connectedPhone: string | null;
  } {
    const session = this.sessions.get(userId);
    if (!session) {
      return { status: 'DISCONNECTED', connectedPhone: null };
    }
    return session.getQuickStatus();
  }

  public getConnectedCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (session.isConnected()) count++;
    }
    return count;
  }

  public shutdownAll(): void {
    for (const session of this.sessions.values()) {
      session.shutdownGracefully();
    }
  }

  public async autoConnectExistingSessions(): Promise<void> {
    try {
      if (!fs.existsSync(config.sessionDir)) return;
      const entries = fs.readdirSync(config.sessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const userId = entry.name;
        const credsPath = path.join(config.sessionDir, userId, 'creds.json');
        if (!fs.existsSync(credsPath)) continue;

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });
        if (!user) continue;

        const session = this.getSession(userId);
        await logActivity(
          userId,
          'WHATSAPP',
          'Sessão local detectada. Restaurando conexão com o WhatsApp...',
          'INFO'
        );
        void session.connect();
      }
    } catch (err) {
      console.error('[WhatsAppManager] Falha ao restaurar sessões:', err);
    }
  }
}

export const whatsappManager = new WhatsAppManager();
