import { PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient();

export async function ensureDefaults(): Promise<void> {
  // 1. Garante registro único de configurações globais
  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      aiProvider: config.aiProvider,
      geminiApiKey: config.geminiApiKey,
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

  // Migra automaticamente o modelo descontinuado gemini-2.5-flash para o modelo configurado
  await prisma.appSettings.updateMany({
    where: { id: 1, geminiModel: 'gemini-2.5-flash' },
    data: { geminiModel: config.geminiModel },
  });

  // 2. Garante tags padrão úteis
  const defaultTags = [
    { name: 'Leads', color: '#3b82f6' },
    { name: 'Clientes VIP', color: '#f59e0b' },
    { name: 'Suporte', color: '#10b981' },
  ];

  for (const tag of defaultTags) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      update: {},
      create: tag,
    });
  }

  // 3. Garante uma regra Global padrão caso não exista
  const globalRule = await prisma.aiRule.findFirst({
    where: { scope: 'GLOBAL' },
  });

  if (!globalRule) {
    await prisma.aiRule.create({
      data: {
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

  // 4. Recuperação segura de campanhas interrompidas por reinício do servidor
  await prisma.campaignItem.updateMany({
    where: { status: 'SENDING' },
    data: { status: 'PENDING' },
  });

  await prisma.campaign.updateMany({
    where: { status: 'RUNNING' },
    data: { status: 'PAUSED' },
  });
}
