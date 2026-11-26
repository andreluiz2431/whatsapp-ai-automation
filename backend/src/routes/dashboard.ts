import { Router } from 'express';
import { prisma } from '../db';
import {
  checkAiHealth,
  generateDailyExecutiveSummary,
} from '../services/aiService';
import { campaignQueue } from '../services/campaignQueue';

export const dashboardRouter = Router();

dashboardRouter.get('/overview', async (_req, res) => {
  try {
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
    ] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { mode: 'AUTO' } }),
      prisma.message.count({
        where: { direction: 'OUTBOUND', createdAt: { gte: startOfDay } },
      }),
      prisma.message.count({
        where: { direction: 'INBOUND', createdAt: { gte: startOfDay } },
      }),
      prisma.campaignItem.count({
        where: {
          status: 'PENDING',
          campaign: { status: { in: ['DRAFT', 'RUNNING', 'PAUSED'] } },
        },
      }),
      prisma.appSettings.findUnique({ where: { id: 1 } }),
      prisma.activityLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 60,
      }),
      checkAiHealth(),
    ]);

    res.json({
      metrics: {
        activeConversations,
        autoConversations,
        messagesSentToday,
        messagesReceivedToday,
        pendingQueueCount,
      },
      aiHealth,
      campaignRuntime: campaignQueue.getRuntimeState(),
      dailySummary: {
        text: settings?.lastDailySummary || null,
        updatedAt: settings?.lastDailySummaryAt || null,
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
    const limit = Math.min(Number(req.query.limit || 80), 200);
    const logs = await prisma.activityLog.findMany({
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

dashboardRouter.post('/daily-summary', async (_req, res) => {
  try {
    const summary = await generateDailyExecutiveSummary();
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
