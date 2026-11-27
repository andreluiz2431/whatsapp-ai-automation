import { Router } from 'express';
import { prisma } from '../db';
import {
  checkAiHealth,
  generateDailyExecutiveSummary,
  getAiUsageSummary,
  getUserSettings,
} from '../services/aiService';
import { campaignQueueManager } from '../services/campaignQueue';

export const dashboardRouter = Router();

dashboardRouter.get('/ai-usage', async (req, res) => {
  try {
    const summary = await getAiUsageSummary(req.user!.id);
    res.json(summary);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Erro ao consultar uso da IA.',
    });
  }
});

dashboardRouter.get('/overview', async (req, res) => {
  try {
    const userId = req.user!.id;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [
      activeConversations,
      autoConversations,
      messagesSentToday,
      messagesReceivedToday,
      pendingQueueCount,
      settings,
      logs,
      aiHealth,
      attentionConversations,
    ] = await Promise.all([
      prisma.conversation.count({ where: { userId } }),
      prisma.conversation.count({ where: { userId, mode: 'AUTO' } }),
      prisma.message.count({
        where: {
          direction: 'OUTBOUND',
          createdAt: { gte: startOfDay },
          conversation: { userId },
        },
      }),
      prisma.message.count({
        where: {
          direction: 'INBOUND',
          createdAt: { gte: startOfDay },
          conversation: { userId },
        },
      }),
      prisma.campaignItem.count({
        where: {
          status: 'PENDING',
          campaign: { userId, status: { in: ['DRAFT', 'RUNNING', 'PAUSED'] } },
        },
      }),
      getUserSettings(userId),
      prisma.activityLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      checkAiHealth(userId),
      prisma.conversation.findMany({
        where: { userId, needsHumanAttention: true },
        orderBy: { humanAttentionAt: 'desc' },
        include: { contact: true },
        take: 20,
      }),
    ]);

    const humanAttentionAlerts = attentionConversations.map((c) => ({
      conversationId: c.id,
      contactName: c.contact.name || c.contact.phone,
      contactPhone: c.contact.phone,
      reason:
        c.humanAttentionReason ||
        'Conversa redirecionada para atendimento humano.',
      lastMessagePreview: c.lastMessagePreview,
      since: (c.humanAttentionAt || c.updatedAt).toISOString(),
      unreadCount: c.unreadCount,
    }));

    res.json({
      metrics: {
        activeConversations,
        autoConversations,
        messagesSentToday,
        messagesReceivedToday,
        pendingQueueCount,
      },
      aiHealth,
      campaignRuntime: campaignQueueManager.getRunner(userId).getRuntimeState(),
      humanAttentionAlerts,
      dailySummary: {
        text: settings.lastDailySummary || null,
        updatedAt: settings.lastDailySummaryAt || null,
      },
      logs,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao carregar dashboard.',
    });
  }
});

dashboardRouter.get('/logs', async (req, res) => {
  try {
    const userId = req.user!.id;
    const limit = Math.min(Number(req.query.limit || 80), 200);
    const logs = await prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json(logs);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao carregar logs.',
    });
  }
});

dashboardRouter.post('/daily-summary', async (req, res) => {
  try {
    const userId = req.user!.id;
    const summary = await generateDailyExecutiveSummary(userId);
    res.json({ summary, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao gerar resumo executivo do dia.',
    });
  }
});
