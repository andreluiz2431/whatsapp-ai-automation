import { AiRule, AiTrainingExample, UserSettings } from '@prisma/client';
import { config } from '../config';
import { ensureUserDefaults, prisma } from '../db';
import { emitUserEvent, logActivity } from './activityLog';

export type AiUsageFeature =
  | 'chat'
  | 'vision'
  | 'audio'
  | 'summary'
  | 'variation'
  | 'training'
  | 'test';

export interface AiUsageSummary {
  requestsToday: number;
  dailyRequestLimit: number;
  inputTokensToday: number;
  outputTokensToday: number;
  totalTokensToday: number;
  visionToday: number;
  audioToday: number;
  requestsMonth: number;
  totalTokensMonth: number;
  provider: 'gemini' | 'ollama';
  model: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface TrainingExtractionResult {
  suggestedExamples: Array<{
    customerMessage: string;
    idealResponse: string;
    feedbackNote: string;
  }>;
  knowledgeAdditions: string;
  promptTips: string;
}

export interface ResolvedRuleResult {
  rule: AiRule | null;
  levelLabel: 'Individual' | 'Campanha' | 'Grupo/Tag' | 'Global' | 'Padrão';
}

export interface AiReplyResult {
  text: string;
  shouldTransferToHuman: boolean;
  ruleName: string;
  ruleLevel: string;
}

export interface AiHealthStatus {
  provider: 'gemini' | 'ollama';
  model: string;
  ready: boolean;
  details: string;
}

const TRANSFER_TOKEN = '[TRANSFERIR_HUMANO]';

export async function getUserSettings(userId: string): Promise<UserSettings> {
  let settings = await prisma.userSettings.findUnique({ where: { userId } });
  if (!settings) {
    await ensureUserDefaults(userId, false);
    settings = await prisma.userSettings.findUnique({ where: { userId } });
  }
  if (!settings) {
    throw new Error('Configurações do usuário não encontradas.');
  }
  return settings;
}

/**
 * Resolve a regra de IA do usuário seguindo a hierarquia:
 * 1. Individual (contato específico)
 * 2. Fluxo específico atribuído à conversa (ex: via campanha)
 * 3. Grupo / Tag do contato
 * 4. Global (padrão)
 */
export async function resolveRuleForContact(
  userId: string,
  contactId: string,
  assignedRuleId?: string | null
): Promise<ResolvedRuleResult> {
  const contactRule = await prisma.aiRule.findFirst({
    where: { userId, scope: 'CONTACT', contactId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (contactRule) {
    return { rule: contactRule, levelLabel: 'Individual' };
  }

  if (assignedRuleId) {
    const campaignRule = await prisma.aiRule.findFirst({
      where: { id: assignedRuleId, userId, isActive: true },
    });
    if (campaignRule) {
      return { rule: campaignRule, levelLabel: 'Campanha' };
    }
  }

  const contactTags = await prisma.contactTag.findMany({
    where: { contactId },
    select: { tagId: true },
  });
  if (contactTags.length > 0) {
    const tagIds = contactTags.map((t) => t.tagId);
    const tagRule = await prisma.aiRule.findFirst({
      where: { userId, scope: 'TAG', tagId: { in: tagIds }, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (tagRule) {
      return { rule: tagRule, levelLabel: 'Grupo/Tag' };
    }
  }

  const globalRule = await prisma.aiRule.findFirst({
    where: { userId, scope: 'GLOBAL', isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (globalRule) {
    return { rule: globalRule, levelLabel: 'Global' };
  }

  return { rule: null, levelLabel: 'Padrão' };
}

async function getTrainingExamplesForRule(
  userId: string,
  ruleId?: string | null
): Promise<AiTrainingExample[]> {
  return prisma.aiTrainingExample.findMany({
    where: {
      userId,
      isActive: true,
      OR: ruleId ? [{ ruleId }, { ruleId: null }] : [{ ruleId: null }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 15,
  });
}

function buildSystemPrompt(
  rule: AiRule | null,
  contactName: string | null,
  trainingExamples: AiTrainingExample[] = []
): string {
  const objective =
    rule?.objective ||
    'Ajudar o cliente de forma educada, objetiva e prestativa.';
  const tone =
    rule?.toneOfVoice || 'Cordial, natural e direto (estilo WhatsApp).';
  const knowledge =
    rule?.knowledgeBase || 'Nenhuma base adicional informada.';
  const stopCondition =
    rule?.stopCondition ||
    'Se o cliente pedir explicitamente para falar com um humano ou apresentar um problema crítico.';

  const examplesBlock =
    trainingExamples.length > 0
      ? [
          '',
          '### EXEMPLOS DE ATENDIMENTO APROVADOS (TREINAMENTO)',
          'Use estes exemplos reais e correções como referência prioritária de estilo e precisão:',
          ...trainingExamples.map((ex, idx) =>
            [
              `Exemplo ${idx + 1}:`,
              `- Cliente: ${ex.customerMessage}`,
              `- Resposta ideal: ${ex.idealResponse}`,
              ex.feedbackNote ? `- Observação: ${ex.feedbackNote}` : '',
            ]
              .filter(Boolean)
              .join('\n')
          ),
        ].join('\n')
      : '';

  return [
    'Você é um assistente virtual de atendimento no WhatsApp.',
    contactName ? `Nome do contato: ${contactName}.` : '',
    '',
    '### OBJETIVO DA CONVERSA',
    objective,
    '',
    '### TOM DE VOZ',
    tone,
    '',
    '### INFORMAÇÕES DE CONTEXTO / BASE DE CONHECIMENTO',
    knowledge,
    examplesBlock,
    '',
    '### CONDIÇÃO DE PARADA / TRANSFERÊNCIA PARA HUMANO',
    stopCondition,
    '',
    '### REGRAS OBRIGATÓRIAS DE RESPOSTA',
    '- Responda em português do Brasil (a menos que o cliente escreva em outro idioma).',
    '- Mantenha as mensagens naturais, concisas e fáceis de ler no WhatsApp (evite blocos enormes de texto ou markdown excessivo).',
    '- Não invente preços, promessas ou dados que não estejam na base de conhecimento.',
    `- Se a CONDIÇÃO DE PARADA for atingida, informe educadamente que um atendente humano dará continuidade e inclua exatamente a tag ${TRANSFER_TOKEN} no final da mensagem.`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listAvailableGeminiModels(userId: string): Promise<string[]> {
  const settings = await getUserSettings(userId);
  const apiKey = settings.geminiApiKey;
  if (!apiKey) return [];

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
        apiKey
      )}`
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    return (data.models || [])
      .filter(
        (m) =>
          m.name?.startsWith('models/gemini-') &&
          m.supportedGenerationMethods?.includes('generateContent')
      )
      .map((m) => (m.name || '').replace(/^models\//, ''));
  } catch {
    return [];
  }
}

export async function getAiUsageSummary(
  userId: string
): Promise<AiUsageSummary> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [settings, todayAgg, visionToday, audioToday, monthAgg] = await Promise.all([
    getUserSettings(userId),
    prisma.aiUsageLog.aggregate({
      where: { userId, createdAt: { gte: startOfDay } },
      _count: { id: true },
      _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
    }),
    prisma.aiUsageLog.count({
      where: { userId, feature: 'vision', createdAt: { gte: startOfDay } },
    }),
    prisma.aiUsageLog.count({
      where: { userId, feature: 'audio', createdAt: { gte: startOfDay } },
    }),
    prisma.aiUsageLog.aggregate({
      where: { userId, createdAt: { gte: startOfMonth } },
      _count: { id: true },
      _sum: { totalTokens: true },
    }),
  ]);

  const provider = (settings.aiProvider || 'gemini') as 'gemini' | 'ollama';
  const model =
    provider === 'ollama'
      ? settings.ollamaModel || config.ollamaModel
      : settings.geminiModel || config.geminiModel;

  return {
    requestsToday: todayAgg._count.id || 0,
    dailyRequestLimit: Math.max(1, settings.dailyAiRequestLimit || 250),
    inputTokensToday: todayAgg._sum.inputTokens || 0,
    outputTokensToday: todayAgg._sum.outputTokens || 0,
    totalTokensToday: todayAgg._sum.totalTokens || 0,
    visionToday,
    audioToday,
    requestsMonth: monthAgg._count.id || 0,
    totalTokensMonth: monthAgg._sum.totalTokens || 0,
    provider,
    model,
  };
}

async function recordAiUsage(
  userId: string,
  provider: 'gemini' | 'ollama',
  model: string,
  feature: AiUsageFeature,
  inputTokens: number,
  outputTokens: number,
  totalTokens?: number
): Promise<void> {
  try {
    const safeIn = Math.max(0, Math.round(inputTokens || 0));
    const safeOut = Math.max(0, Math.round(outputTokens || 0));
    const safeTotal = Math.max(safeIn + safeOut, Math.round(totalTokens || 0));

    await prisma.aiUsageLog.create({
      data: {
        userId,
        provider,
        model,
        feature,
        inputTokens: safeIn,
        outputTokens: safeOut,
        totalTokens: safeTotal,
      },
    });

    const summary = await getAiUsageSummary(userId);
    emitUserEvent(userId, 'ai:usage', summary);
  } catch (err) {
    console.error('[AiUsage] Falha ao registrar uso da IA:', err);
  }
}

async function callGeminiSingleModel(
  apiKey: string,
  model: string,
  systemPrompt: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>
): Promise<
  | {
      ok: true;
      text: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }
  | { ok: false; status: number; errText: string }
> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { ok: false, status: response.status, errText };
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };

  const parts = data.candidates?.[0]?.content?.parts || [];
  const visibleParts = parts.filter((p) => !p.thought && p.text);
  const text = (visibleParts.length > 0 ? visibleParts : parts)
    .map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || 'UNKNOWN';
    return {
      ok: false,
      status: 500,
      errText: `A API Gemini retornou uma resposta vazia (finishReason: ${reason}).`,
    };
  }

  const inputTokens =
    data.usageMetadata?.promptTokenCount ??
    Math.ceil(
      (systemPrompt.length +
        contents.reduce((a, c) => a + (c.parts[0]?.text?.length || 0), 0)) /
        4
    );
  const outputTokens =
    data.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4);
  const totalTokens =
    data.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens;

  return { ok: true, text, inputTokens, outputTokens, totalTokens };
}

async function callGemini(
  userId: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  turns: ChatTurn[],
  feature: AiUsageFeature
): Promise<string> {
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY não configurada na sua conta. Adicione sua chave gratuita do Google AI Studio em Configurações IA.'
    );
  }

  const contents = turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content }],
  }));

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Olá' }] });
  } else if (contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: '(início da conversa)' }] });
  }

  let lastError = '';
  let lastStatus = 0;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await callGeminiSingleModel(apiKey, model, systemPrompt, contents);
    if (res.ok) {
      await recordAiUsage(
        userId,
        'gemini',
        model,
        feature,
        res.inputTokens,
        res.outputTokens,
        res.totalTokens
      );
      return res.text;
    }

    lastStatus = res.status;
    lastError = res.errText;

    if (res.status === 503 || res.status === 429) {
      if (attempt < 3) {
        await sleepMs(1500 * attempt);
        continue;
      }
    } else {
      break;
    }
  }

  if (lastStatus === 503 || lastStatus === 429 || lastStatus === 404) {
    const available = await listAvailableGeminiModels(userId);
    const fallbacks = available
      .filter(
        (m) =>
          m !== model &&
          (m.includes('flash') || m.includes('lite')) &&
          !m.includes('tts') &&
          !m.includes('image') &&
          !m.includes('audio')
      )
      .slice(0, 3);

    for (const fallbackModel of fallbacks) {
      const res = await callGeminiSingleModel(
        apiKey,
        fallbackModel,
        systemPrompt,
        contents
      );
      if (res.ok) {
        await recordAiUsage(
          userId,
          'gemini',
          fallbackModel,
          feature,
          res.inputTokens,
          res.outputTokens,
          res.totalTokens
        );
        await logActivity(
          userId,
          'AI',
          `Modelo principal "${model}" indisponível (${lastStatus}); resposta gerada via fallback "${fallbackModel}".`,
          'WARN'
        );
        return res.text;
      }
    }
  }

  throw new Error(`Erro Gemini API (${lastStatus}): ${lastError.slice(0, 300)}`);
}

async function callOllama(
  userId: string,
  baseUrl: string,
  model: string,
  systemPrompt: string,
  turns: ChatTurn[],
  feature: AiUsageFeature
): Promise<string> {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const endpoint = `${cleanUrl}/api/chat`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...turns.map((t) => ({
      role: t.role,
      content: t.content,
    })),
  ];

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro Ollama (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };

  const text = data.message?.content?.trim();
  if (!text) {
    throw new Error('O Ollama retornou uma resposta vazia.');
  }

  const inputTokens =
    data.prompt_eval_count ??
    Math.ceil(
      (systemPrompt.length +
        turns.reduce((a, t) => a + t.content.length, 0)) /
        4
    );
  const outputTokens = data.eval_count ?? Math.ceil(text.length / 4);
  await recordAiUsage(userId, 'ollama', model, feature, inputTokens, outputTokens);

  return text;
}

async function invokeProvider(
  userId: string,
  systemPrompt: string,
  turns: ChatTurn[],
  feature: AiUsageFeature = 'chat'
): Promise<string> {
  const settings = await getUserSettings(userId);
  const provider = settings.aiProvider || 'gemini';

  if (provider === 'ollama') {
    const baseUrl = settings.ollamaBaseUrl || config.ollamaBaseUrl;
    const model = settings.ollamaModel || config.ollamaModel;
    return callOllama(userId, baseUrl, model, systemPrompt, turns, feature);
  }

  const apiKey = settings.geminiApiKey;
  const model = settings.geminiModel || config.geminiModel;
  return callGemini(userId, apiKey, model, systemPrompt, turns, feature);
}

export async function generateConversationReply(
  userId: string,
  conversationId: string
): Promise<AiReplyResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });

  if (!conversation) {
    throw new Error('Conversa não encontrada.');
  }

  const { rule, levelLabel } = await resolveRuleForContact(
    userId,
    conversation.contactId,
    conversation.activeRuleId
  );

  const examples = await getTrainingExamplesForRule(userId, rule?.id);
  const systemPrompt = buildSystemPrompt(rule, conversation.contact.name, examples);

  const ordered = [...conversation.messages].reverse();
  const turns: ChatTurn[] = [];
  for (const msg of ordered) {
    const role: 'user' | 'assistant' =
      msg.direction === 'INBOUND' ? 'user' : 'assistant';
    const extras: string[] = [];
    if (msg.imageAnalysis) {
      extras.push(`[Conteúdo lido da imagem enviada]: ${msg.imageAnalysis}`);
    }
    if (msg.audioTranscript) {
      extras.push(`[Transcrição do áudio enviado]: ${msg.audioTranscript}`);
    }
    const contentText =
      extras.length > 0 ? `${msg.body}\n${extras.join('\n')}` : msg.body;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n${contentText}`;
    } else {
      turns.push({ role, content: contentText });
    }
  }

  const rawText = await invokeProvider(userId, systemPrompt, turns);
  const shouldTransferToHuman = rawText.includes(TRANSFER_TOKEN);
  const cleanText = rawText.replace(TRANSFER_TOKEN, '').trim();

  return {
    text:
      cleanText ||
      'Vou transferir seu atendimento para um de nossos especialistas humanos agora mesmo!',
    shouldTransferToHuman,
    ruleName: rule?.name || 'Padrão do Sistema',
    ruleLevel: levelLabel,
  };
}

export async function generateConversationSummary(
  userId: string,
  conversationId: string
): Promise<string> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      contact: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 60,
      },
    },
  });

  if (!conversation) {
    throw new Error('Conversa não encontrada.');
  }

  if (conversation.messages.length === 0) {
    return 'Ainda não há mensagens nesta conversa para resumir.';
  }

  const transcript = conversation.messages
    .map((m) => {
      const who =
        m.direction === 'INBOUND'
          ? conversation.contact.name || conversation.contact.phone
          : m.senderType === 'AI'
            ? 'IA'
            : m.senderType === 'CAMPAIGN'
              ? 'Campanha'
              : 'Humano';
      return `[${who}]: ${m.body}`;
    })
    .join('\n');

  const systemPrompt =
    'Você é um analista de atendimento executivo. Gere um resumo objetivo em português com: 1) Assunto/Interesse principal, 2) Status atual da conversa, 3) Próximo passo recomendado. Máximo de 4 frases ou tópicos curtos.';

  const summary = await invokeProvider(userId, systemPrompt, [
    { role: 'user', content: `Resuma esta conversa de WhatsApp:\n\n${transcript}` },
  ]);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      aiSummary: summary,
      aiSummaryUpdatedAt: new Date(),
    },
  });

  await logActivity(
    userId,
    'AI',
    `Resumo gerado por IA para ${conversation.contact.name || conversation.contact.phone}`,
    'INFO'
  );

  return summary;
}

export async function generateDailyExecutiveSummary(
  userId: string
): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayMessages, activeConversations, campaigns] = await Promise.all([
    prisma.message.findMany({
      where: {
        createdAt: { gte: startOfDay },
        conversation: { userId },
      },
      include: { conversation: { include: { contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 120,
    }),
    prisma.conversation.count({
      where: { userId, lastMessageAt: { gte: startOfDay } },
    }),
    prisma.campaign.findMany({
      where: { userId, updatedAt: { gte: startOfDay } },
      select: {
        name: true,
        status: true,
        sentCount: true,
        failedCount: true,
        totalCount: true,
      },
    }),
  ]);

  if (todayMessages.length === 0 && campaigns.length === 0) {
    const emptySummary =
      'Nenhuma mensagem ou campanha registrada hoje até o momento.';
    await prisma.userSettings.update({
      where: { userId },
      data: { lastDailySummary: emptySummary, lastDailySummaryAt: new Date() },
    });
    return emptySummary;
  }

  const inboundCount = todayMessages.filter((m) => m.direction === 'INBOUND').length;
  const aiCount = todayMessages.filter((m) => m.senderType === 'AI').length;
  const humanCount = todayMessages.filter((m) => m.senderType === 'HUMAN').length;
  const campaignMsgCount = todayMessages.filter(
    (m) => m.senderType === 'CAMPAIGN'
  ).length;

  const sampleTranscript = [...todayMessages]
    .reverse()
    .slice(-50)
    .map((m) => {
      const contactLabel =
        m.conversation.contact.name || m.conversation.contact.phone;
      return `(${contactLabel} | ${m.senderType}): ${m.body.slice(0, 140)}`;
    })
    .join('\n');

  const statsText = [
    `Conversas movimentadas hoje: ${activeConversations}`,
    `Mensagens recebidas: ${inboundCount}`,
    `Respostas da IA: ${aiCount}`,
    `Mensagens manuais (humano): ${humanCount}`,
    `Disparos de campanha: ${campaignMsgCount}`,
    `Campanhas ativas/atualizadas hoje: ${
      campaigns.length > 0
        ? campaigns
            .map((c) => `${c.name} (${c.status}: ${c.sentCount}/${c.totalCount})`)
            .join('; ')
        : 'Nenhuma'
    }`,
  ].join('\n');

  const systemPrompt =
    'Você é um gerente de operações de atendimento. Gere um Resumo Executivo do Dia em português do Brasil claro e estruturado com tópicos: Visão Geral, Principais Temas dos Clientes, Desempenho da IA/Campanhas e Alertas/Recomendações.';

  const summary = await invokeProvider(userId, systemPrompt, [
    {
      role: 'user',
      content: `Dados do dia:\n${statsText}\n\nAmostra recente das conversas:\n${sampleTranscript}`,
    },
  ]);

  await prisma.userSettings.update({
    where: { userId },
    data: {
      lastDailySummary: summary,
      lastDailySummaryAt: new Date(),
    },
  });

  await logActivity(userId, 'AI', 'Resumo executivo diário gerado pela IA.', 'SUCCESS');
  return summary;
}

export async function generateMessageVariation(
  userId: string,
  renderedTemplate: string,
  contactName: string
): Promise<string> {
  try {
    const systemPrompt =
      'Você reescreve mensagens curtas de WhatsApp criando pequenas variações naturais na saudação e na fraseologia para evitar textos idênticos em massa. Mantenha 100% do sentido original, o nome do contato e qualquer link/informação importante. Retorne APENAS a mensagem final, sem aspas nem explicações.';

    const varied = await invokeProvider(userId, systemPrompt, [
      {
        role: 'user',
        content: `Crie uma variação natural e humana desta mensagem para ${contactName}:\n\n${renderedTemplate}`,
      },
    ]);

    return varied || renderedTemplate;
  } catch {
    return renderedTemplate;
  }
}

export async function checkAiHealth(userId: string): Promise<AiHealthStatus> {
  const settings = await getUserSettings(userId);
  const provider = (settings.aiProvider || 'gemini') as 'gemini' | 'ollama';

  if (provider === 'ollama') {
    const baseUrl = (settings.ollamaBaseUrl || config.ollamaBaseUrl).replace(
      /\/+$/,
      ''
    );
    const model = settings.ollamaModel || config.ollamaModel;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        return {
          provider: 'ollama',
          model,
          ready: false,
          details: `Ollama respondeu com status ${res.status}`,
        };
      }

      const data = (await res.json()) as {
        models?: Array<{ name: string }>;
      };
      const installed = data.models?.map((m) => m.name) || [];
      const hasModel = installed.some(
        (n) => n === model || n.startsWith(`${model}:`)
      );

      return {
        provider: 'ollama',
        model,
        ready: hasModel,
        details: hasModel
          ? `Ollama online (${installed.length} modelo(s) disponível(is))`
          : `Ollama online, mas modelo "${model}" não encontrado. Rode: ollama pull ${model}`,
      };
    } catch {
      return {
        provider: 'ollama',
        model,
        ready: false,
        details: `Ollama inacessível em ${baseUrl}. Inicie o serviço Ollama localmente.`,
      };
    }
  }

  const apiKey = settings.geminiApiKey;
  const model = settings.geminiModel || config.geminiModel;

  if (!apiKey) {
    return {
      provider: 'gemini',
      model,
      ready: false,
      details:
        'Configure sua própria chave GEMINI_API_KEY em Configurações IA.',
    };
  }

  return {
    provider: 'gemini',
    model,
    ready: true,
    details: 'Google Gemini API (Free Tier) configurado na sua conta.',
  };
}

export async function testAiConnection(userId: string): Promise<{
  ok: boolean;
  reply?: string;
  error?: string;
}> {
  try {
    const reply = await invokeProvider(
      userId,
      'Responda de forma muito curta em português confirmando que o motor de IA está ativo.',
      [{ role: 'user', content: 'Teste de conexão. Tudo funcionando?' }]
    );
    return { ok: true, reply };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erro desconhecido ao testar IA.',
    };
  }
}

/**
 * Leitura multimodal de imagens usando Gemini Flash/Flash-Lite (nativo no Free Tier)
 * ou Ollama multimodal (ex: llama3.2-vision, gemma3, llava).
 */
export async function analyzeImageWithAi(
  userId: string,
  base64Data: string,
  mimeType: string,
  caption?: string
): Promise<{ description: string; modelUsed: string }> {
  const settings = await getUserSettings(userId);
  const provider = settings.aiProvider || 'gemini';
  const promptBase =
    settings.imageAnalysisPrompt ||
    'Descreva a imagem de forma objetiva em português para ajudar no atendimento de WhatsApp. Extraia textos legíveis, valores, datas, códigos, comprovantes ou detalhes do produto/erro mostrados.';
  const fullPrompt = caption
    ? `${promptBase}\n\nLegenda enviada pelo cliente junto com a imagem: "${caption}"`
    : promptBase;

  if (provider === 'ollama') {
    const baseUrl = (settings.ollamaBaseUrl || config.ollamaBaseUrl).replace(
      /\/+$/,
      ''
    );
    const model = settings.ollamaModel || config.ollamaModel;
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: fullPrompt,
            images: [base64Data],
          },
        ],
      }),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Erro Ollama Vision (${response.status}): ${errText.slice(0, 260)}`
      );
    }
    const data = (await response.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    const description = data.message?.content?.trim();
    if (!description) {
      throw new Error('Ollama não retornou descrição para a imagem.');
    }
    await recordAiUsage(
      userId,
      'ollama',
      model,
      'vision',
      data.prompt_eval_count ?? 300,
      data.eval_count ?? Math.ceil(description.length / 4)
    );
    return { description, modelUsed: model };
  }

  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY não configurada na sua conta para leitura de imagens.'
    );
  }

  const primaryModel =
    settings.geminiVisionModel?.trim() ||
    settings.geminiModel ||
    config.geminiModel;

  const tryVisionModel = async (modelName: string) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelName
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: fullPrompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false as const, status: response.status, errText };
    }
    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();
    if (!text) {
      return {
        ok: false as const,
        status: 500,
        errText: 'Gemini retornou resposta vazia para a imagem.',
      };
    }
    return {
      ok: true as const,
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 350,
      outputTokens:
        data.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
      totalTokens: data.usageMetadata?.totalTokenCount,
    };
  };

  let lastStatus = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await tryVisionModel(primaryModel);
    if (res.ok) {
      await recordAiUsage(
        userId,
        'gemini',
        primaryModel,
        'vision',
        res.inputTokens,
        res.outputTokens,
        res.totalTokens
      );
      return { description: res.text, modelUsed: primaryModel };
    }
    lastStatus = res.status;
    lastError = res.errText;
    if (res.status === 503 || res.status === 429) {
      await sleepMs(1500 * attempt);
    } else {
      break;
    }
  }

  // Fallback automático para modelos Flash/Lite da conta
  if (lastStatus === 503 || lastStatus === 429 || lastStatus === 404) {
    const available = await listAvailableGeminiModels(userId);
    const fallbacks = available
      .filter(
        (m) =>
          m !== primaryModel &&
          (m.includes('lite') || m.includes('flash')) &&
          !m.includes('tts') &&
          !m.includes('image') &&
          !m.includes('audio')
      )
      .slice(0, 3);

    for (const fb of fallbacks) {
      const res = await tryVisionModel(fb);
      if (res.ok) {
        await recordAiUsage(
          userId,
          'gemini',
          fb,
          'vision',
          res.inputTokens,
          res.outputTokens,
          res.totalTokens
        );
        return { description: res.text, modelUsed: fb };
      }
    }
  }

  throw new Error(
    `Erro Gemini Vision (${lastStatus}): ${lastError.slice(0, 300)}`
  );
}

/**
 * Transcrição e interpretação nativa de áudios/mensagens de voz do WhatsApp (OGG Opus, MP3, M4A, WAV)
 * usando modelos Gemini Flash/Flash-Lite diretamente no Free Tier (sem Whisper externo nem FFmpeg).
 */
export async function transcribeAudioWithAi(
  userId: string,
  base64Data: string,
  rawMimeType: string
): Promise<{ transcript: string; modelUsed: string }> {
  const settings = await getUserSettings(userId);
  const apiKey = settings.geminiApiKey;

  if (!apiKey) {
    throw new Error(
      'Transcrição nativa de áudio requer GEMINI_API_KEY configurada na sua conta (mesmo se usar Ollama para texto, você pode salvar sua chave gratuita do Gemini).'
    );
  }

  // Normaliza mimeType do WhatsApp (ex: "audio/ogg; codecs=opus" -> "audio/ogg")
  const cleanMime = (rawMimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
  const mimeType = cleanMime.startsWith('audio/') ? cleanMime : 'audio/ogg';

  const prompt =
    settings.audioTranscriptionPrompt ||
    'Transcreva fielmente o áudio enviado no WhatsApp em português. Se houver informações importantes no tom ou contexto, adicione uma breve observação entre colchetes ao final.';

  const primaryModel =
    settings.geminiAudioModel?.trim() ||
    settings.geminiModel ||
    config.geminiModel;

  const tryAudioModel = async (modelName: string) => {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelName
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return { ok: false as const, status: response.status, errText };
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    };

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || '')
      .join('')
      .trim();

    if (!text) {
      return {
        ok: false as const,
        status: 500,
        errText: 'Gemini retornou transcrição vazia para o áudio.',
      };
    }

    return {
      ok: true as const,
      text,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 400,
      outputTokens:
        data.usageMetadata?.candidatesTokenCount ?? Math.ceil(text.length / 4),
      totalTokens: data.usageMetadata?.totalTokenCount,
    };
  };

  let lastStatus = 0;
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await tryAudioModel(primaryModel);
    if (res.ok) {
      await recordAiUsage(
        userId,
        'gemini',
        primaryModel,
        'audio',
        res.inputTokens,
        res.outputTokens,
        res.totalTokens
      );
      return { transcript: res.text, modelUsed: primaryModel };
    }
    lastStatus = res.status;
    lastError = res.errText;
    if (res.status === 503 || res.status === 429) {
      await sleepMs(1500 * attempt);
    } else {
      break;
    }
  }

  // Fallback automático para outros modelos Flash/Lite disponíveis na conta
  if (lastStatus === 503 || lastStatus === 429 || lastStatus === 404) {
    const available = await listAvailableGeminiModels(userId);
    const fallbacks = available
      .filter(
        (m) =>
          m !== primaryModel &&
          (m.includes('lite') || m.includes('flash')) &&
          !m.includes('tts') &&
          !m.includes('image')
      )
      .slice(0, 3);

    for (const fb of fallbacks) {
      const res = await tryAudioModel(fb);
      if (res.ok) {
        await recordAiUsage(
          userId,
          'gemini',
          fb,
          'audio',
          res.inputTokens,
          res.outputTokens,
          res.totalTokens
        );
        return { transcript: res.text, modelUsed: fb };
      }
    }
  }

  throw new Error(
    `Erro Gemini Áudio (${lastStatus}): ${lastError.slice(0, 300)}`
  );
}

/**
 * Simulador interativo de atendimento para treinar a IA antes ou durante o uso real.
 */
export async function simulateTrainingChat(
  userId: string,
  ruleId: string | null,
  turns: ChatTurn[]
): Promise<{ reply: string; ruleName: string; shouldTransferToHuman: boolean }> {
  let rule: AiRule | null = null;
  if (ruleId) {
    rule = await prisma.aiRule.findFirst({ where: { id: ruleId, userId } });
  }
  if (!rule) {
    rule = await prisma.aiRule.findFirst({
      where: { userId, scope: 'GLOBAL', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  const examples = await getTrainingExamplesForRule(userId, rule?.id);
  const systemPrompt = buildSystemPrompt(rule, 'Cliente (Simulação)', examples);

  const rawText = await invokeProvider(userId, systemPrompt, turns);
  const shouldTransferToHuman = rawText.includes(TRANSFER_TOKEN);
  const cleanText = rawText.replace(TRANSFER_TOKEN, '').trim();

  return {
    reply: cleanText || 'Transferindo para um atendente humano.',
    ruleName: rule?.name || 'Padrão do Sistema',
    shouldTransferToHuman,
  };
}

/**
 * Analisa um histórico de conversa (real do WhatsApp ou do Simulador de Treino)
 * e extrai exemplos de treinamento (few-shot) + lacunas na base de conhecimento.
 */
export async function extractTrainingFromTranscript(
  userId: string,
  transcript: string,
  userFeedback?: string,
  ruleId?: string | null
): Promise<TrainingExtractionResult> {
  let ruleContext = '';
  if (ruleId) {
    const rule = await prisma.aiRule.findFirst({ where: { id: ruleId, userId } });
    if (rule) {
      ruleContext = `\nRegra atual alvo: "${rule.name}"\nObjetivo atual: ${rule.objective}\nBase de conhecimento atual: ${rule.knowledgeBase}\n`;
    }
  }

  const systemPrompt = [
    'Você é um especialista em treinamento e engenharia de prompts para assistentes de WhatsApp.',
    'Analise o histórico da conversa abaixo e o feedback do usuário (se houver).',
    'Extraia os melhores exemplos de treinamento (pergunta do cliente -> resposta ideal aprimorada) e sugestões concretas para enriquecer a Base de Conhecimento.',
    'Responda ESTRITAMENTE em JSON válido (sem markdown ```json, sem texto fora do JSON) no formato:',
    '{',
    '  "suggestedExamples": [',
    '    { "customerMessage": "...", "idealResponse": "...", "feedbackNote": "..." }',
    '  ],',
    '  "knowledgeAdditions": "Texto curto em tópicos para adicionar na Base de Conhecimento da regra (ou string vazia se não precisar)",',
    '  "promptTips": "Resumo curto em português com 2 a 3 recomendações práticas para melhorar o atendimento"',
    '}',
  ].join('\n');

  const userPrompt = [
    ruleContext,
    userFeedback ? `Feedback / instruções do usuário:\n${userFeedback}\n` : '',
    `Histórico da conversa:\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n');

  const raw = await invokeProvider(userId, systemPrompt, [
    { role: 'user', content: userPrompt },
  ]);

  // Remove eventuais blocos ```json ... ``` que o modelo incluir
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  const jsonSlice =
    jsonStart !== -1 && jsonEnd !== -1
      ? cleaned.slice(jsonStart, jsonEnd + 1)
      : cleaned;

  try {
    const parsed = JSON.parse(jsonSlice) as Partial<TrainingExtractionResult>;
    return {
      suggestedExamples: Array.isArray(parsed.suggestedExamples)
        ? parsed.suggestedExamples
            .filter((e) => e?.customerMessage && e?.idealResponse)
            .slice(0, 6)
            .map((e) => ({
              customerMessage: String(e.customerMessage).trim(),
              idealResponse: String(e.idealResponse).trim(),
              feedbackNote: String(e.feedbackNote || '').trim(),
            }))
        : [],
      knowledgeAdditions: String(parsed.knowledgeAdditions || '').trim(),
      promptTips: String(parsed.promptTips || '').trim(),
    };
  } catch {
    return {
      suggestedExamples: [],
      knowledgeAdditions: '',
      promptTips: raw,
    };
  }
}

export async function extractTrainingFromConversation(
  userId: string,
  conversationId: string,
  userFeedback?: string,
  ruleId?: string | null
): Promise<TrainingExtractionResult> {
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: {
      contact: true,
      messages: { orderBy: { createdAt: 'asc' }, take: 80 },
    },
  });
  if (!conv) {
    throw new Error('Conversa não encontrada.');
  }
  if (conv.messages.length === 0) {
    throw new Error('Esta conversa ainda não possui mensagens para analisar.');
  }

  const transcript = conv.messages
    .map((m) => {
      const who =
        m.direction === 'INBOUND'
          ? `Cliente (${conv.contact.name || conv.contact.phone})`
          : m.senderType === 'HUMAN'
            ? 'Atendente Humano (referência)'
            : m.senderType === 'AI'
              ? 'IA Atual'
              : 'Campanha';
      const extraParts: string[] = [];
      if (m.imageAnalysis) extraParts.push(`[Imagem: ${m.imageAnalysis}]`);
      if (m.audioTranscript) extraParts.push(`[Áudio: ${m.audioTranscript}]`);
      const extra = extraParts.length > 0 ? ` ${extraParts.join(' ')}` : '';
      return `[${who}]: ${m.body}${extra}`;
    })
    .join('\n');

  const result = await extractTrainingFromTranscript(
    userId,
    transcript,
    userFeedback,
    ruleId || conv.activeRuleId
  );

  await logActivity(
    userId,
    'AI',
    `Histórico da conversa com ${conv.contact.name || conv.contact.phone} analisado para treinamento (${result.suggestedExamples.length} exemplo(s) sugerido(s)).`,
    'SUCCESS'
  );

  return result;
}
