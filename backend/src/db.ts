import { PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient();

/**
 * Inicialização global segura ao subir o servidor.
 */
export async function ensureServerRecovery(): Promise<void> {
  // Recuperação segura de campanhas interrompidas por reinício do servidor
  await prisma.campaignItem.updateMany({
    where: { status: 'SENDING' },
    data: { status: 'PENDING' },
  });

  await prisma.campaign.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PAUSED' },
  });

  // Migra modelo Gemini descontinuado se algum usuário ainda o tiver salvo
  await prisma.userSettings.updateMany({
    where: { geminiModel: 'gemini-2.5-flash' },
    data: { geminiModel: config.geminiModel },
  });

  // Garante que o dono (OWNER_EMAIL ou isOwner=true) tenha papel ADMIN ativo
  if (config.ownerEmail) {
    await prisma.user.updateMany({
      where: { email: config.ownerEmail },
      data: { isOwner: true, role: 'ADMIN', status: 'ACTIVE', licenseStatus: 'ACTIVE' },
    });
  }
  await prisma.user.updateMany({
    where: { isOwner: true },
    data: { role: 'ADMIN', status: 'ACTIVE', licenseStatus: 'ACTIVE' },
  });

  // Provisiona configuração global de cadastros/licenças (novos usuários entram ATIVOS por padrão)
  await prisma.systemConfig.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      requireAdminApproval: false,
      defaultNewUserPlan: 'FREE',
      defaultTrialDays: 0,
    },
  });
}

/**
 * Provisiona configurações, tags e regra Global padrão de forma isolada para cada usuário.
 * Somente o usuário dono (primeiro cadastro ou OWNER_EMAIL) herda a GEMINI_API_KEY do ambiente;
 * os demais usuários configuram sua própria chave de IA.
 */
export async function ensureUserDefaults(
  userId: string,
  inheritServerGeminiKey = false
): Promise<void> {
  await prisma.userSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      aiProvider: config.aiProvider,
      geminiApiKey: inheritServerGeminiKey ? config.geminiApiKey : '',
      geminiModel: config.geminiModel,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaModel: config.ollamaModel,
      globalAutomationPaused: false,
      autoPauseOnManualSend: config.autoPauseOnManualSend,
      autoSummarizeConversations: false,
      defaultMinDelaySec: config.defaultMinDelaySec,
      defaultMaxDelaySec: config.defaultMaxDelaySec,
      defaultBatchSize: config.defaultBatchSize,
      defaultBatchPauseMin: config.defaultBatchPauseMin,
    },
  });

  const defaultTags = [
    { name: 'Leads', color: '#3b82f6' },
    { name: 'Clientes VIP', color: '#f59e0b' },
    { name: 'Suporte', color: '#10b981' },
  ];

  for (const tag of defaultTags) {
    await prisma.tag.upsert({
      where: { userId_name: { userId, name: tag.name } },
      update: {},
      create: { userId, name: tag.name, color: tag.color },
    });
  }

  const globalRule = await prisma.aiRule.findFirst({
    where: { userId, scope: 'GLOBAL' },
  });

  if (!globalRule) {
    await prisma.aiRule.create({
      data: {
        userId,
        name: 'Atendimento Padrão (Global)',
        scope: 'GLOBAL',
        isActive: true,
        objective:
          'Recepcionar o contato com cordialidade, entender sua necessidade principal e fornecer respostas claras e objetivas.',
        toneOfVoice:
          'Amigável, profissional, natural e humano (evite textos longos demais; escreva como em uma conversa real de WhatsApp).',
        knowledgeBase:
          'Somos uma empresa focada em atendimento ágil e consultivo. Horário de atendimento humano: Segunda a Sexta, das 9h às 18h.',
        stopCondition:
          'Transferir para atendente humano se o cliente pedir explicitamente para falar com uma pessoa, reclamar de cobrança/estorno ou solicitar negociação especial.',
      },
    });
  }
}
