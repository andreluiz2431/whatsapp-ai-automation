import { Router } from 'express';
import { prisma } from '../db';
import { logActivity } from '../services/activityLog';
import { whatsappManager } from '../services/whatsappService';

export const whatsappRouter = Router();

whatsappRouter.get('/status', async (req, res) => {
  try {
    const userId = req.user!.id;
    const state = await whatsappManager.getSession(userId).getState();
    res.json(state);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao obter status.',
    });
  }
});

whatsappRouter.post('/connect', async (req, res) => {
  try {
    const userId = req.user!.id;
    const session = whatsappManager.getSession(userId);
    void session.connect();
    const state = await session.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao conectar.',
    });
  }
});

whatsappRouter.post('/disconnect', async (req, res) => {
  try {
    const userId = req.user!.id;
    const clearSession = Boolean(req.body?.clearSession);
    const session = whatsappManager.getSession(userId);
    await session.disconnect(clearSession);
    const state = await session.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao desconectar.',
    });
  }
});

whatsappRouter.post('/repair-sessions', async (req, res) => {
  try {
    const userId = req.user!.id;
    const session = whatsappManager.getSession(userId);
    const result = await session.repairEncryptionSessions();
    const state = await session.getState();
    res.json({ ok: true, ...result, state });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao reparar chaves de criptografia do WhatsApp.',
    });
  }
});

whatsappRouter.post('/pause-global', async (req, res) => {
  try {
    const userId = req.user!.id;
    const paused = Boolean(req.body?.paused);
    await prisma.userSettings.update({
      where: { userId },
      data: { globalAutomationPaused: paused },
    });

    await logActivity(
      userId,
      'SYSTEM',
      paused
        ? 'Automação Global da IA PAUSADA pelo usuário.'
        : 'Automação Global da IA REATIVADA.',
      paused ? 'WARN' : 'SUCCESS'
    );

    const session = whatsappManager.getSession(userId);
    await session.broadcastStatus();
    const state = await session.getState();
    res.json({ ok: true, state });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao alternar pausa global.',
    });
  }
});
