import { Router } from 'express';
import { prisma } from '../db';
import { logActivity } from '../services/activityLog';
import { whatsappService } from '../services/whatsappService';

export const whatsappRouter = Router();

whatsappRouter.get('/status', async (_req, res) => {
  try {
    const state = await whatsappService.getState();
    res.json(state);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao obter status.',
    });
  }
});

whatsappRouter.post('/connect', async (_req, res) => {
  try {
    void whatsappService.connect();
    const state = await whatsappService.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao conectar.',
    });
  }
});

whatsappRouter.post('/disconnect', async (req, res) => {
  try {
    const clearSession = Boolean(req.body?.clearSession);
    await whatsappService.disconnect(clearSession);
    const state = await whatsappService.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao desconectar.',
    });
  }
});

whatsappRouter.post('/pause-global', async (req, res) => {
  try {
    const paused = Boolean(req.body?.paused);
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { globalAutomationPaused: paused },
    });

    await logActivity(
      'SYSTEM',
      paused
        ? 'Automação Global da IA PAUSADA pelo usuário.'
        : 'Automação Global da IA REATIVADA.',
      paused ? 'WARN' : 'SUCCESS'
    );

    await whatsappService.broadcastStatus();
    const state = await whatsappService.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao alternar pausa global.',
    });
  }
});
