import { prisma } from '../db';
import { CampaignRuntimeState } from '../types';
import { emitSocketEvent, logActivity } from './activityLog';
import { generateMessageVariation } from './aiService';
import { normalizePhoneAndJid, whatsappService } from './whatsappService';

function randomInt(min: number, max: number): number {
  const safeMin = Math.max(1, Math.min(min, max));
  const safeMax = Math.max(safeMin, max);
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

function renderTemplate(template: string, name: string): string {
  const firstName = name.trim().split(/\s+/)[0] || name;
  return template
    .replace(/\{\{\s*nome\s*\}\}/gi, name)
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, firstName)
    .replace(/\{\{\s*name\s*\}\}/gi, name);
}

class CampaignQueueService {
  private running = false;
  private activeCampaignId: string | null = null;
  private activeCampaignName: string | null = null;
  private phase: CampaignRuntimeState['phase'] = 'IDLE';
  private nextSendAt: Date | null = null;
  private currentContactName: string | null = null;
  private batchSentCounter = 0;
  private stopRequested = false;

  public getRuntimeState(): CampaignRuntimeState {
    return {
      activeCampaignId: this.activeCampaignId,
      activeCampaignName: this.activeCampaignName,
      phase: this.phase,
      nextSendAt: this.nextSendAt ? this.nextSendAt.toISOString() : null,
      currentContactName: this.currentContactName,
      batchSentCounter: this.batchSentCounter,
    };
  }

  private emitRuntime(): void {
    emitSocketEvent('campaign:runtime', this.getRuntimeState());
  }

  private async interruptibleWait(ms: number): Promise<boolean> {
    const endTime = Date.now() + ms;
    this.nextSendAt = new Date(endTime);
    this.emitRuntime();

    while (Date.now() < endTime) {
      if (this.stopRequested) {
        this.nextSendAt = null;
        return false;
      }
      await new Promise((r) => setTimeout(r, Math.min(500, endTime - Date.now())));
    }

    this.nextSendAt = null;
    return true;
  }

  public async startCampaign(campaignId: string): Promise<void> {
    if (this.running && this.activeCampaignId !== campaignId) {
      throw new Error(
        `Já existe uma campanha em andamento ("${this.activeCampaignName}"). Pause ou conclua antes de iniciar outra para respeitar o controle anti-ban.`
      );
    }

    if (!whatsappService.isConnected()) {
      throw new Error(
        'WhatsApp desconectado. Conecte seu dispositivo via QR Code antes de iniciar a campanha.'
      );
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });
    if (!campaign) {
      throw new Error('Campanha não encontrada.');
    }

    const pendingCount = await prisma.campaignItem.count({
      where: { campaignId, status: 'PENDING' },
    });
    if (pendingCount === 0) {
      throw new Error('Não há contatos pendentes nesta campanha.');
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        status: 'RUNNING',
        startedAt: campaign.startedAt || new Date(),
      },
    });

    this.stopRequested = false;
    this.running = true;
    this.activeCampaignId = campaign.id;
    this.activeCampaignName = campaign.name;
    this.batchSentCounter = 0;

    whatsappService.setCampaignRunning(true);
    await logActivity(
      'CAMPAIGN',
      `Campanha "${campaign.name}" iniciada (${pendingCount} contato(s) na fila). Intervalo anti-ban: ${campaign.minDelaySec}s–${campaign.maxDelaySec}s.`,
      'SUCCESS'
    );

    void this.processLoop(campaign.id);
  }

  public async pauseCampaign(campaignId: string): Promise<void> {
    if (this.activeCampaignId === campaignId) {
      this.stopRequested = true;
    }

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED' },
    });

    await logActivity('CAMPAIGN', 'Campanha pausada pelo usuário.', 'WARN');
    emitSocketEvent('campaign:progress', { campaignId });
    emitSocketEvent('dashboard:refresh', {});
  }

  public async cancelCampaign(campaignId: string): Promise<void> {
    if (this.activeCampaignId === campaignId) {
      this.stopRequested = true;
    }

    await prisma.campaignItem.updateMany({
      where: { campaignId, status: { in: ['PENDING', 'SENDING'] } },
      data: { status: 'CANCELLED' },
    });

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    await logActivity('CAMPAIGN', 'Campanha cancelada.', 'WARN');
    emitSocketEvent('campaign:progress', { campaignId });
    emitSocketEvent('dashboard:refresh', {});
  }

  private async processLoop(campaignId: string): Promise<void> {
    try {
      while (!this.stopRequested) {
        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
        });
        if (!campaign || campaign.status !== 'RUNNING') {
          break;
        }

        const nextItem = await prisma.campaignItem.findFirst({
          where: { campaignId, status: 'PENDING' },
          orderBy: { createdAt: 'asc' },
        });

        if (!nextItem) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'COMPLETED', completedAt: new Date() },
          });
          await logActivity(
            'CAMPAIGN',
            `Campanha "${campaign.name}" concluída! Enviados: ${campaign.sentCount}, Erros: ${campaign.failedCount}.`,
            'SUCCESS'
          );
          emitSocketEvent('campaign:progress', { campaignId });
          emitSocketEvent('dashboard:refresh', {});
          break;
        }

        // Garante conexão antes de enviar
        if (!whatsappService.isConnected()) {
          this.phase = 'WAITING_CONNECTION';
          this.currentContactName = nextItem.name;
          this.emitRuntime();
          await logActivity(
            'CAMPAIGN',
            'WhatsApp desconectado durante campanha. Pausando disparos automaticamente.',
            'WARN'
          );
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: 'PAUSED' },
          });
          emitSocketEvent('campaign:progress', { campaignId });
          break;
        }

        // Marca item em envio
        this.phase = 'SENDING';
        this.currentContactName = nextItem.name;
        this.emitRuntime();

        await prisma.campaignItem.update({
          where: { id: nextItem.id },
          data: { status: 'SENDING' },
        });

        const { phone, jid } = normalizePhoneAndJid(nextItem.phone);
        let finalMessage = renderTemplate(campaign.messageTemplate, nextItem.name);

        if (campaign.useAiVariation) {
          finalMessage = await generateMessageVariation(
            finalMessage,
            nextItem.name
          );
        }

        try {
          await logActivity(
            'CAMPAIGN',
            `Simulando digitação e enviando para ${nextItem.name} (${phone})...`,
            'INFO'
          );

          const waMessageId = await whatsappService.simulateTypingAndSend(
            jid,
            finalMessage,
            true
          );

          // Garante contato e conversa no banco para aparecer no painel de chat
          const contact = await prisma.contact.upsert({
            where: { jid },
            update: { name: nextItem.name },
            create: { phone, jid, name: nextItem.name },
          });

          const conversation = await prisma.conversation.upsert({
            where: { contactId: contact.id },
            update: {
              mode: campaign.autoEnableAiOnReply ? 'AUTO' : 'MANUAL',
              activeRuleId: campaign.autoEnableAiOnReply
                ? campaign.aiRuleId || null
                : null,
              lastMessageAt: new Date(),
              lastMessagePreview: finalMessage.slice(0, 120),
            },
            create: {
              contactId: contact.id,
              mode: campaign.autoEnableAiOnReply ? 'AUTO' : 'MANUAL',
              activeRuleId: campaign.autoEnableAiOnReply
                ? campaign.aiRuleId || null
                : null,
              lastMessageAt: new Date(),
              lastMessagePreview: finalMessage.slice(0, 120),
            },
            include: {
              contact: { include: { tags: { include: { tag: true } } } },
              activeRule: true,
            },
          });

          const savedMsg = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              waMessageId: waMessageId || undefined,
              direction: 'OUTBOUND',
              senderType: 'CAMPAIGN',
              body: finalMessage,
              status: 'SENT',
            },
          });

          await prisma.campaignItem.update({
            where: { id: nextItem.id },
            data: {
              status: 'SENT',
              contactId: contact.id,
              resolvedMessage: finalMessage,
              sentAt: new Date(),
            },
          });

          await prisma.campaign.update({
            where: { id: campaignId },
            data: { sentCount: { increment: 1 } },
          });

          this.batchSentCounter += 1;

          emitSocketEvent('message:new', savedMsg);
          emitSocketEvent('conversation:updated', conversation);
          emitSocketEvent('campaign:progress', { campaignId });
          emitSocketEvent('dashboard:refresh', {});

          await logActivity(
            'CAMPAIGN',
            `Disparo enviado para ${nextItem.name} (${phone}).`,
            'SUCCESS'
          );
        } catch (sendErr) {
          const errMsg =
            sendErr instanceof Error
              ? sendErr.message
              : 'Erro desconhecido no envio';

          await prisma.campaignItem.update({
            where: { id: nextItem.id },
            data: {
              status: 'FAILED',
              resolvedMessage: finalMessage,
              errorMessage: errMsg,
            },
          });

          await prisma.campaign.update({
            where: { id: campaignId },
            data: { failedCount: { increment: 1 } },
          });

          emitSocketEvent('campaign:progress', { campaignId });
          emitSocketEvent('dashboard:refresh', {});

          await logActivity(
            'CAMPAIGN',
            `Erro ao enviar para ${nextItem.name} (${phone}): ${errMsg}`,
            'ERROR'
          );
        }

        // Verifica se ainda há itens pendentes antes de aguardar intervalo anti-ban
        const remaining = await prisma.campaignItem.count({
          where: { campaignId, status: 'PENDING' },
        });
        if (remaining === 0 || this.stopRequested) {
          continue;
        }

        // Pausa em lote anti-ban (padrão: 5 min a cada 20 mensagens)
        if (
          campaign.batchSize > 0 &&
          this.batchSentCounter >= campaign.batchSize
        ) {
          this.batchSentCounter = 0;
          const pauseMs = Math.max(1, campaign.batchPauseMin) * 60 * 1000;
          this.phase = 'BATCH_PAUSE';
          await logActivity(
            'CAMPAIGN',
            `Pausa em lote anti-ban: aguardando ${campaign.batchPauseMin} minuto(s) após ${campaign.batchSize} disparos...`,
            'WARN'
          );
          const completedWait = await this.interruptibleWait(pauseMs);
          if (!completedWait) break;
        } else {
          // Jitter aleatório entre minDelaySec e maxDelaySec (padrão: 45s–120s)
          const delaySec = randomInt(campaign.minDelaySec, campaign.maxDelaySec);
          this.phase = 'JITTER_DELAY';
          await logActivity(
            'CAMPAIGN',
            `Aguardando intervalo anti-ban de ${delaySec}s antes do próximo disparo (${remaining} restante(s))...`,
            'INFO'
          );
          const completedWait = await this.interruptibleWait(delaySec * 1000);
          if (!completedWait) break;
        }
      }
    } finally {
      this.running = false;
      this.activeCampaignId = null;
      this.activeCampaignName = null;
      this.phase = 'IDLE';
      this.nextSendAt = null;
      this.currentContactName = null;
      this.stopRequested = false;
      whatsappService.setCampaignRunning(false);
      this.emitRuntime();
    }
  }
}

export const campaignQueue = new CampaignQueueService();
