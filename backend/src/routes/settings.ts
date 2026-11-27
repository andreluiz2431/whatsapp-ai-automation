import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { emitUserEvent, logActivity } from '../services/activityLog';
import {
  analyzeImageWithAi,
  checkAiHealth,
  getAiUsageSummary,
  getUserSettings,
  listAvailableGeminiModels,
  testAiConnection,
  transcribeAudioWithAi,
} from '../services/aiService';
import { isUserAdmin } from '../services/authService';
import {
  evaluateBusinessHours,
  sanitizeWeeklySchedule,
} from '../services/businessHours';
import { whatsappManager } from '../services/whatsappService';

export const settingsRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

settingsRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const [settings, aiHealth] = await Promise.all([
      getUserSettings(userId),
      checkAiHealth(userId),
    ]);
    const businessHoursStatus = evaluateBusinessHours(settings);
    res.json({ settings, aiHealth, businessHoursStatus });
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
      enableAudioTranscription,
      geminiAudioModel,
      audioTranscriptionPrompt,
      responseTone,
      trainingFlexibility,
      responseLength,
      emojiStyle,
      customStyleNote,
      dailyAiRequestLimit,
      defaultMinDelaySec,
      defaultMaxDelaySec,
      defaultBatchSize,
      defaultBatchPauseMin,
      businessHoursEnabled,
      businessHoursTimezone,
      businessHoursMode,
      businessHoursScheduleJson,
      offHoursAction,
      offHoursMessage,
      offHoursCooldownMin,
    } = req.body;

    const isAdmin = isUserAdmin(req.user!);
    const allowVision = isAdmin || req.user!.permissions.vision;
    const allowAudio = isAdmin || req.user!.permissions.audio;

    await getUserSettings(userId);
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
        ...(enableImageReading !== undefined && allowVision
          ? { enableImageReading: Boolean(enableImageReading) }
          : {}),
        ...(geminiVisionModel !== undefined
          ? { geminiVisionModel: String(geminiVisionModel).trim() }
          : {}),
        ...(imageAnalysisPrompt !== undefined
          ? { imageAnalysisPrompt: String(imageAnalysisPrompt).trim() }
          : {}),
        ...(enableAudioTranscription !== undefined && allowAudio
          ? { enableAudioTranscription: Boolean(enableAudioTranscription) }
          : {}),
        ...(geminiAudioModel !== undefined
          ? { geminiAudioModel: String(geminiAudioModel).trim() }
          : {}),
        ...(audioTranscriptionPrompt !== undefined
          ? {
              audioTranscriptionPrompt: String(audioTranscriptionPrompt).trim(),
            }
          : {}),
        ...(responseTone !== undefined
          ? { responseTone: String(responseTone).trim().toUpperCase() || 'CONSULTATIVE' }
          : {}),
        ...(trainingFlexibility !== undefined
          ? {
              trainingFlexibility:
                String(trainingFlexibility).trim().toUpperCase() || 'BALANCED',
            }
          : {}),
        ...(responseLength !== undefined
          ? { responseLength: String(responseLength).trim().toUpperCase() || 'MEDIUM' }
          : {}),
        ...(emojiStyle !== undefined
          ? { emojiStyle: String(emojiStyle).trim().toUpperCase() || 'LIGHT' }
          : {}),
        ...(customStyleNote !== undefined
          ? { customStyleNote: String(customStyleNote).trim() }
          : {}),
        ...(dailyAiRequestLimit !== undefined
          ? {
              dailyAiRequestLimit: Math.max(
                10,
                Number(dailyAiRequestLimit) || 250
              ),
            }
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
        ...(businessHoursEnabled !== undefined
          ? { businessHoursEnabled: Boolean(businessHoursEnabled) }
          : {}),
        ...(businessHoursTimezone !== undefined
          ? {
              businessHoursTimezone:
                String(businessHoursTimezone).trim() || 'America/Sao_Paulo',
            }
          : {}),
        ...(businessHoursMode !== undefined
          ? {
              businessHoursMode:
                String(businessHoursMode).toUpperCase() === 'INVERSE_AFTER_HOURS'
                  ? 'INVERSE_AFTER_HOURS'
                  : 'ACTIVE_DURING_HOURS',
            }
          : {}),
        ...(businessHoursScheduleJson !== undefined
          ? {
              businessHoursScheduleJson: JSON.stringify(
                sanitizeWeeklySchedule(businessHoursScheduleJson)
              ),
            }
          : {}),
        ...(offHoursAction !== undefined
          ? {
              offHoursAction:
                String(offHoursAction).toUpperCase() === 'SEND_MESSAGE'
                  ? 'SEND_MESSAGE'
                  : 'PAUSE',
            }
          : {}),
        ...(offHoursMessage !== undefined
          ? { offHoursMessage: String(offHoursMessage).trim() }
          : {}),
        ...(offHoursCooldownMin !== undefined
          ? {
              offHoursCooldownMin: Math.max(
                1,
                Math.min(1440, Number(offHoursCooldownMin) || 60)
              ),
            }
          : {}),
      },
    });

    const [aiHealth, aiUsage] = await Promise.all([
      checkAiHealth(userId),
      getAiUsageSummary(userId),
    ]);
    const businessHoursStatus = evaluateBusinessHours(updated);
    await whatsappManager.getSession(userId).broadcastStatus();
    emitUserEvent(userId, 'ai:usage', aiUsage);
    emitUserEvent(userId, 'dashboard:refresh', {});
    await logActivity(
      userId,
      'SYSTEM',
      `Configurações atualizadas (Provedor IA: ${
        updated.aiProvider === 'gemini'
          ? `Gemini ${updated.geminiModel}`
          : `Ollama ${updated.ollamaModel}`
      }${updated.enableImageReading ? ' • Leitura de Imagens ATIVA' : ''}${
        updated.businessHoursEnabled
          ? ` • Horário de Trabalho ATIVO (${
              updated.businessHoursMode === 'INVERSE_AFTER_HOURS'
                ? 'Atendimento Inverso'
                : 'Horário Comercial'
            })`
          : ''
      }).`,
      'INFO'
    );

    res.json({ settings: updated, aiHealth, businessHoursStatus });
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
    if (!isUserAdmin(req.user!) && !req.user!.permissions.vision) {
      res.status(403).json({
        ok: false,
        error: 'O módulo Leitura de Imagens (Visão IA) não está liberado para sua conta.',
      });
      return;
    }
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

settingsRouter.post('/test-audio', upload.single('audio'), async (req, res) => {
  try {
    const userId = req.user!.id;
    if (!isUserAdmin(req.user!) && !req.user!.permissions.audio) {
      res.status(403).json({
        ok: false,
        error: 'O módulo Transcrição de Áudios (Áudio IA) não está liberado para sua conta.',
      });
      return;
    }
    if (!req.file) {
      res.status(400).json({ ok: false, error: 'Envie um arquivo de áudio para testar.' });
      return;
    }
    const result = await transcribeAudioWithAi(
      userId,
      req.file.buffer.toString('base64'),
      req.file.mimetype || 'audio/ogg'
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao transcrever áudio de teste.',
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
