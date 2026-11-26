import makeWASocket, {
  Browsers,
  DisconnectReason,
  WASocket,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
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

  constructor(userId: string) {
    this.userId = userId;
    this.sessionPath = path.join(config.sessionDir, userId);
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

          this.status = 'DISCONNECTED';

          if (loggedOut) {
            this.connectedPhone = null;
            this.connectedName = null;
            this.lastError =
              'Sessão desconectada pelo celular. Limpe a sessão e escaneie um novo QR Code.';
            this.shouldReconnect = false;
            await this.clearSessionFiles();
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

  private async clearSessionFiles(): Promise<void> {
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
        await this.sock.presenceSubscribe(jid);
        await this.sock.sendPresenceUpdate('composing', jid);
        const typingMs = randomInt(3000, 7000);
        await sleep(typingMs);
        await this.sock.sendPresenceUpdate('paused', jid);
      } catch {
        // Best-effort
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
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: this.userId },
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

    const settings = await prisma.userSettings.findUnique({
      where: { userId: this.userId },
    });
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
      const remoteJid = msg.key?.remoteJid;
      if (!remoteJid) return;
      if (msg.key.fromMe) return;
      if (remoteJid === 'status@broadcast' || remoteJid.endsWith('@g.us')) {
        return;
      }

      const imageMsg = msg.message?.imageMessage;
      const audioMsg = msg.message?.audioMessage;
      const caption = imageMsg?.caption?.trim() || '';
      let body = extractTextFromMessage(msg.message).trim();
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

      if (!body) return;

      const settings = await prisma.userSettings.findUnique({
        where: { userId: this.userId },
      });

      const phone = remoteJid.split('@')[0].replace(/\D/g, '');
      const pushName = msg.pushName?.trim() || null;

      // Se o módulo de leitura de imagens estiver ativo para este usuário, analisa com IA multimodal
      if (imageMsg && settings?.enableImageReading) {
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

      // Se o módulo de transcrição de áudio estiver ativo para este usuário, transcreve com Gemini multimodal
      if (audioMsg && settings?.enableAudioTranscription) {
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

      const contact = await prisma.contact.upsert({
        where: { userId_jid: { userId: this.userId, jid: remoteJid } },
        update: pushName ? { name: pushName } : {},
        create: {
          userId: this.userId,
          phone,
          jid: remoteJid,
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
        this.userId,
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
      const [settings, conv] = await Promise.all([
        prisma.userSettings.findUnique({ where: { userId: this.userId } }),
        prisma.conversation.findFirst({
          where: { id: conversationId, userId: this.userId },
        }),
      ]);

      if (!conv || conv.mode !== 'AUTO' || settings?.globalAutomationPaused) {
        return;
      }

      const reply = await generateConversationReply(this.userId, conversationId);
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
          `Condição de parada atingida para ${contactLabel}. Conversa transferida para modo Manual.`,
          'WARN'
        );
      }

      if (settings?.autoSummarizeConversations) {
        void generateConversationSummary(this.userId, conversationId).catch(
          () => {}
        );
      }
    } catch (err) {
      await logActivity(
        this.userId,
        'AI',
        `Falha na resposta da IA para ${contactLabel}: ${
          err instanceof Error ? err.message : 'Erro desconhecido'
        }`,
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
