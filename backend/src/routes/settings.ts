import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { emitUserEvent, logActivity } from '../services/activityLog';
import {
  analyzeImageWithAi,
  checkAiHealth,
  getUserSettings,
  listAvailableGeminiModels,
  testAiConnection,
} from '../services/aiService';
import { whatsappManager } from '../services/whatsappService';

export const settingsRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
});

settingsRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const [settings, aiHealth] = await Promise.all([
      getUserSettings(userId),
      checkAiHealth(userId),
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
    const userId = req.user!.id;
    const {
      aiProvider,
      geminiApiKey,
      geminiModel,
      ollamaBaseUrl,
      ollamaModel,
      globalAutomationPaused,
      autoPauseOnManualSend,
      autoSummarizeConversations,
      enableImageReading,
      geminiVisionModel,
      imageAnalysisPrompt,
      defaultMinDelaySec,
      defaultMaxDelaySec,
      defaultBatchSize,
      defaultBatchPauseMin,
    } = req.body;

    const updated = await prisma.userSettings.update({
      where: { userId },
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
        ...(enableImageReading !== undefined
          ? { enableImageReading: Boolean(enableImageReading) }
          : {}),
        ...(geminiVisionModel !== undefined
          ? { geminiVisionModel: String(geminiVisionModel).trim() }
          : {}),
        ...(imageAnalysisPrompt !== undefined
          ? { imageAnalysisPrompt: String(imageAnalysisPrompt).trim() }
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

    const aiHealth = await checkAiHealth(userId);
    await whatsappManager.getSession(userId).broadcastStatus();
    emitUserEvent(userId, 'dashboard:refresh', {});
    await logActivity(
      userId,
      'SYSTEM',
      `Configurações atualizadas (Provedor IA: ${
        updated.aiProvider === 'gemini'
          ? `Gemini ${updated.geminiModel}`
          : `Ollama ${updated.ollamaModel}`
      }${updated.enableImageReading ? ' • Leitura de Imagens ATIVA' : ''}).`,
      'INFO'
    );

    res.json({ settings: updated, aiHealth });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao salvar configurações.',
    });
  }
});

settingsRouter.post('/test-ai', async (req, res) => {
  try {
    const userId = req.user!.id;
    const result = await testAiConnection(userId);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : 'Erro ao testar IA.',
    });
  }
});

settingsRouter.post('/test-vision', upload.single('image'), async (req, res) => {
  try {
    const userId = req.user!.id;
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Envie uma imagem para testar.' });
      return;
    }
    const caption = String(req.body?.caption || '').trim() || undefined;
    const result = await analyzeImageWithAi(
      userId,
      req.file.buffer.toString('base64'),
      req.file.mimetype || 'image/jpeg',
      caption
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        err instanceof Error ? err.message : 'Erro ao analisar imagem de teste.',
    });
  }
});

settingsRouter.get('/gemini-models', async (req, res) => {
  try {
    const userId = req.user!.id;
    const models = await listAvailableGeminiModels(userId);
    res.json({ models });
  } catch {
    res.json({ models: [] });
  }
});
