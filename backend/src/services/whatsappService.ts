import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  proto,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from '../config';
import { prisma } from '../db';
import { WhatsAppConnectionStatus, WhatsAppStatePayload } from '../types';
import { emitSocketEvent, logActivity } from './activityLog';
import {
  generateConversationReply,
  generateConversationSummary,
} from './aiService';

const logger = pino({ level: 'silent' });

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
  // Heurística amigável para Brasil: 10 ou 11 dígitos sem DDI -> prefixa 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = `55${digits}`;
  }
  return {
    phone: digits,
    jid: `${digits}@s.whatsapp.net`,
  };
}

function extractTextFromMessage(msg: proto.IMessage | null | undefined): string {
  if (!msg) return '';
  if (msg.conversation) return msg.conversation;
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.imageMessage?.caption) return `[Imagem] ${msg.imageMessage.caption}`;
  if (msg.videoMessage?.caption) return `[Vídeo] ${msg.videoMessage.caption}`;
  if (msg.documentMessage?.caption)
    return `[Documento] ${msg.documentMessage.caption}`;
  if (msg.buttonsResponseMessage?.selectedDisplayText)
    return msg.buttonsResponseMessage.selectedDisplayText;
  if (msg.listResponseMessage?.title) return msg.listResponseMessage.title;
  return '';
}

class WhatsAppService {
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

  public hasSavedSession(): boolean {
    try {
      return (
        fs.existsSync(config.sessionDir) &&
        fs.existsSync(`${config.sessionDir}/creds.json`)
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

  public async getState(): Promise<WhatsAppStatePayload> {
    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
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
    emitSocketEvent('whatsapp:status', state);
  }

  public async autoConnectIfSessionExists(): Promise<void> {
    if (this.hasSavedSession()) {
      await logActivity(
        'WHATSAPP',
        'Sessão local detectada. Restaurando conexão com o WhatsApp...',
        'INFO'
      );
      await this.connect();
    }
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
      fs.mkdirSync(config.sessionDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

      let version: [number, number, number] = [2, 3000, 1023223821];
      try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;
      } catch {
        // Fallback para versão conhecida caso sem acesso à verificação remota
      }

      const sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('ZapFlow AI'),
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
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
          emitSocketEvent('whatsapp:qr', { qrDataUrl: this.qrDataUrl });
          await this.broadcastStatus();
          await logActivity(
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

          emitSocketEvent('whatsapp:qr', { qrDataUrl: null });
          await this.broadcastStatus();
          await logActivity(
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

          this.status = 'DISCONNECTED';

          if (loggedOut) {
            this.connectedPhone = null;
            this.connectedName = null;
            this.lastError =
              'Sessão desconectada pelo celular. Limpe a sessão e escaneie um novo QR Code.';
            this.shouldReconnect = false;
            await this.clearSessionFiles();
            await logActivity('WHATSAPP', this.lastError, 'WARN');
          } else if (this.shouldReconnect) {
            this.reconnectAttempts += 1;
            const delayMs = Math.min(3000 * this.reconnectAttempts, 30000);
            this.lastError = `Conexão interrompida (código ${statusCode ?? 'desconhecido'}). Reconectando em ${Math.round(
              delayMs / 1000
            )}s...`;
            await logActivity('WHATSAPP', this.lastError, 'WARN');

            this.reconnectTimer = setTimeout(() => {
              void this.connect();
            }, delayMs);
          } else {
            await logActivity('WHATSAPP', 'WhatsApp desconectado.', 'INFO');
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
      await logActivity('WHATSAPP', this.lastError, 'ERROR');
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
        // Ignora erro caso socket já esteja fechado
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

    emitSocketEvent('whatsapp:qr', { qrDataUrl: null });
    await this.broadcastStatus();
    await logActivity(
      'WHATSAPP',
      clearSession
        ? 'Sessão encerrada e credenciais locais removidas.'
        : 'Conexão encerrada (sessão local preservada).',
      'INFO'
    );
  }

  private async clearSessionFiles(): Promise<void> {
    try {
      if (fs.existsSync(config.sessionDir)) {
        fs.rmSync(config.sessionDir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error('[WhatsApp] Erro ao limpar auth_session:', err);
    }
  }

  /**
   * Simula presença "digitando..." por 3 a 7 segundos antes de enviar
   */
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
        await this.sock.presenceSubscribe(jid);
        await this.sock.sendPresenceUpdate('composing', jid);
        const typingMs = randomInt(3000, 7000);
        await sleep(typingMs);
        await this.sock.sendPresenceUpdate('paused', jid);
      } catch {
        // Presence update é best-effort; não impede envio se falhar
      }
    }

    const sent = await this.sock.sendMessage(jid, { text });
    return sent?.key?.id || null;
  }

  public async sendManualMessage(
    conversationId: string,
    body: string
  ): Promise<{
    message: Awaited<ReturnType<typeof prisma.message.create>>;
    autoPausedAi: boolean;
  }> {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { contact: true },
    });

    if (!conversation) {
      throw new Error('Conversa não encontrada.');
    }

    const waMessageId = await this.simulateTypingAndSend(
      conversation.contact.jid,
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

    const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
    let autoPausedAi = false;

    const updateData: {
      lastMessageAt: Date;
      lastMessagePreview: string;
      unreadCount: number;
      mode?: string;
    } = {
      lastMessageAt: new Date(),
      lastMessagePreview: body.slice(0, 120),
      unreadCount: 0,
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

    emitSocketEvent('message:new', message);
    emitSocketEvent('conversation:updated', updatedConv);
    emitSocketEvent('dashboard:refresh', {});

    await logActivity(
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
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) return;
      if (msg.key.fromMe) return;
      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) {
        return; // Ignora status e grupos para focar em atendimento 1:1
      }

      const body = extractTextFromMessage(msg.message).trim();
      if (!body) return;

      const waMessageId = msg.key.id || undefined;
      if (waMessageId) {
        const exists = await prisma.message.findUnique({
          where: { waMessageId },
        });
        if (exists) return;
      }

      const phone = remoteJid.split('@')[0].replace(/\D/g, '');
      const pushName = msg.pushName?.trim() || null;

      // Upsert contato
      const contact = await prisma.contact.upsert({
        where: { jid: remoteJid },
        update: pushName ? { name: pushName } : {},
        create: {
          phone,
          jid: remoteJid,
          name: pushName,
        },
      });

      // Upsert conversa
      const conversation = await prisma.conversation.upsert({
        where: { contactId: contact.id },
        update: {
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 120),
          unreadCount: { increment: 1 },
        },
        create: {
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

      const savedMsg = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          waMessageId,
          direction: 'INBOUND',
          senderType: 'CONTACT',
          body,
          status: 'DELIVERED',
        },
      });

      emitSocketEvent('message:new', savedMsg);
      emitSocketEvent('conversation:updated', conversation);
      emitSocketEvent('dashboard:refresh', {});

      const contactLabel = contact.name || contact.phone;
      await logActivity('WHATSAPP', `Mensagem recebida de ${contactLabel}.`, 'INFO');

      // Verifica se automação global e modo da conversa permitem resposta da IA
      const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
      if (settings?.globalAutomationPaused) {
        await logActivity(
          'AI',
          `Automação global pausada — IA não respondeu ${contactLabel}.`,
          'WARN'
        );
        return;
      }

      if (conversation.mode !== 'AUTO') {
        await logActivity(
          'AI',
          `Chat com ${contactLabel} está em modo Manual — aguardando resposta humana.`,
          'INFO'
        );
        return;
      }

      // Debounce de 2.5s para agrupar mensagens picadas do cliente
      const existingTimer = this.pendingAiTimers.get(conversation.id);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.pendingAiTimers.delete(conversation.id);
        void this.respondWithAi(conversation.id, contact.jid, contactLabel);
      }, 2500);

      this.pendingAiTimers.set(conversation.id, timer);
    } catch (err) {
      console.error('[WhatsApp] Erro ao processar mensagem recebida:', err);
      await logActivity(
        'WHATSAPP',
        `Erro ao processar mensagem recebida: ${
          err instanceof Error ? err.message : 'desconhecido'
        }`,
        'ERROR'
      );
    }
  }

  private async respondWithAi(
    conversationId: string,
    jid: string,
    contactLabel: string
  ): Promise<void> {
    try {
      // Revalida estado antes de gerar e enviar
      const [settings, conv] = await Promise.all([
        prisma.appSettings.findUnique({ where: { id: 1 } }),
        prisma.conversation.findUnique({ where: { id: conversationId } }),
      ]);

      if (!conv || conv.mode !== 'AUTO' || settings?.globalAutomationPaused) {
        return;
      }

      const reply = await generateConversationReply(conversationId);
      const waMessageId = await this.simulateTypingAndSend(jid, reply.text, true);

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
          ...(reply.shouldTransferToHuman ? { mode: 'MANUAL' } : {}),
        },
        include: {
          contact: { include: { tags: { include: { tag: true } } } },
          activeRule: true,
        },
      });

      emitSocketEvent('message:new', savedOut);
      emitSocketEvent('conversation:updated', updatedConv);
      emitSocketEvent('dashboard:refresh', {});

      await logActivity(
        'AI',
        `IA respondeu ${contactLabel} (Regra ${reply.ruleLevel}: ${reply.ruleName}).`,
        'SUCCESS'
      );

      if (reply.shouldTransferToHuman) {
        await logActivity(
          'AI',
          `Condição de parada atingida para ${contactLabel}. Conversa transferida para modo Manual.`,
          'WARN'
        );
      }

      if (settings?.autoSummarizeConversations) {
        void generateConversationSummary(conversationId).catch(() => {});
      }
    } catch (err) {
      await logActivity(
        'AI',
        `Falha na resposta da IA para ${contactLabel}: ${
          err instanceof Error ? err.message : 'Erro desconhecido'
        }`,
        'ERROR'
      );
    }
  }
}

export const whatsappService = new WhatsAppService();
