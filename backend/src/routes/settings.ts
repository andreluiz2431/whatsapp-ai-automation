import { Router } from 'express';
import { prisma } from '../db';
import { emitSocketEvent, logActivity } from '../services/activityLog';
import {
  checkAiHealth,
  listAvailableGeminiModels,
  testAiConnection,
} from '../services/aiService';
import { whatsappService } from '../services/whatsappService';

export const settingsRouter = Router();

settingsRouter.get('/', async (_req, res) => {
  try {
    const [settings, aiHealth] = await Promise.all([
      prisma.appSettings.findUnique({ where: { id: 1 } }),
      checkAiHealth(),
    ]);
    res.json({ settings, aiHealth });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao carregar configurações.',
    });
  }
});

settingsRouter.put('/', async (req, res) => {
  try {
    const {
      aiProvider,
      geminiApiKey,
      geminiModel,
      ollamaBaseUrl,
      ollamaModel,
      globalAutomationPaused,
      autoPauseOnManualSend,
      autoSummarizeConversations,
      defaultMinDelaySec,
      defaultMaxDelaySec,
      defaultBatchSize,
      defaultBatchPauseMin,
    } = req.body;

    const updated = await prisma.appSettings.update({
      where: { id: 1 },
      data: {
        ...(aiProvider !== undefined ? { aiProvider: String(aiProvider) } : {}),
        ...(geminiApiKey !== undefined
          ? { geminiApiKey: String(geminiApiKey).trim() }
          : {}),
        ...(geminiModel !== undefined
          ? { geminiModel: String(geminiModel).trim() }
          : {}),
        ...(ollamaBaseUrl !== undefined
          ? { ollamaBaseUrl: String(ollamaBaseUrl).trim() }
          : {}),
        ...(ollamaModel !== undefined
          ? { ollamaModel: String(ollamaModel).trim() }
          : {}),
        ...(globalAutomationPaused !== undefined
          ? { globalAutomationPaused: Boolean(globalAutomationPaused) }
          : {}),
        ...(autoPauseOnManualSend !== undefined
          ? { autoPauseOnManualSend: Boolean(autoPauseOnManualSend) }
          : {}),
        ...(autoSummarizeConversations !== undefined
          ? { autoSummarizeConversations: Boolean(autoSummarizeConversations) }
          : {}),
        ...(defaultMinDelaySec !== undefined
          ? { defaultMinDelaySec: Math.max(5, Number(defaultMinDelaySec) || 45) }
          : {}),
        ...(defaultMaxDelaySec !== undefined
          ? { defaultMaxDelaySec: Math.max(5, Number(defaultMaxDelaySec) || 120) }
          : {}),
        ...(defaultBatchSize !== undefined
          ? { defaultBatchSize: Math.max(1, Number(defaultBatchSize) || 20) }
          : {}),
        ...(defaultBatchPauseMin !== undefined
          ? { defaultBatchPauseMin: Math.max(1, Number(defaultBatchPauseMin) || 5) }
          : {}),
      },
    });

    const aiHealth = await checkAiHealth();
    await whatsappService.broadcastStatus();
    emitSocketEvent('dashboard:refresh', {});
    await logActivity(
      'SYSTEM',
      `Configurações atualizadas (Provedor IA: ${updated.aiProvider === 'gemini' ? `Gemini ${updated.geminiModel}` : `Ollama ${updated.ollamaModel}`}).`,
      'INFO'
    );

    res.json({ settings: updated, aiHealth });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao salvar configurações.',
    });
  }
});

settingsRouter.post('/test-ai', async (_req, res) => {
  try {
    const result = await testAiConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao testar IA.',
    });
  }
});

settingsRouter.get('/gemini-models', async (_req, res) => {
  try {
    const models = await listAvailableGeminiModels();
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
});
