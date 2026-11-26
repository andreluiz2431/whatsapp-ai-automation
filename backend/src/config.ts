import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: Number(process.env.PORT || 3001),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  sessionDir: path.resolve(
    __dirname,
    '..',
    process.env.WHATSAPP_SESSION_DIR || './auth_session'
  ),
  // Autenticação
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  sessionSecret: (process.env.SESSION_SECRET || '').trim(),
  ownerEmail: (process.env.OWNER_EMAIL || '').trim().toLowerCase(),
  // Provedor de IA (padrões para novos usuários / owner)
  aiProvider: (process.env.AI_PROVIDER || 'gemini') as 'gemini' | 'ollama',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  defaultMinDelaySec: Number(process.env.DEFAULT_MIN_DELAY_SEC || 45),
  defaultMaxDelaySec: Number(process.env.DEFAULT_MAX_DELAY_SEC || 120),
  defaultBatchSize: Number(process.env.DEFAULT_BATCH_SIZE || 20),
  defaultBatchPauseMin: Number(process.env.DEFAULT_BATCH_PAUSE_MIN || 5),
  autoPauseOnManualSend:
    (process.env.AUTO_PAUSE_AI_ON_MANUAL_SEND || 'true').toLowerCase() === 'true',
};
