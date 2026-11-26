import { AiRule, AppSettings } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { logActivity } from './activityLog';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
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

export async function getEffectiveSettings(): Promise<AppSettings> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    throw new Error('Configurações do sistema não inicializadas.');
  }
  return settings;
}

/**
 * Resolve a regra de IA seguindo a hierarquia estrita:
 * 1. Individual (contato específico)
 * 2. Fluxo específico atribuído à conversa (ex: via campanha)
 * 3. Grupo / Tag do contato
 * 4. Global (padrão)
 */
export async function resolveRuleForContact(
  contactId: string,
  assignedRuleId?: string | null
): Promise<ResolvedRuleResult> {
  // 1. Individual (por contato específico)
  const contactRule = await prisma.aiRule.findFirst({
    where: { scope: 'CONTACT', contactId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (contactRule) {
    return { rule: contactRule, levelLabel: 'Individual' };
  }

  // 2. Fluxo específico vinculado à conversa (ex: disparo de campanha)
  if (assignedRuleId) {
    const campaignRule = await prisma.aiRule.findFirst({
      where: { id: assignedRuleId, isActive: true },
    });
    if (campaignRule) {
      return { rule: campaignRule, levelLabel: 'Campanha' };
    }
  }

  // 3. Por Grupo/Tag do contato
  const contactTags = await prisma.contactTag.findMany({
    where: { contactId },
    select: { tagId: true },
  });
  if (contactTags.length > 0) {
    const tagIds = contactTags.map((t) => t.tagId);
    const tagRule = await prisma.aiRule.findFirst({
      where: { scope: 'TAG', tagId: { in: tagIds }, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (tagRule) {
      return { rule: tagRule, levelLabel: 'Grupo/Tag' };
    }
  }

  // 4. Global (Padrão)
  const globalRule = await prisma.aiRule.findFirst({
    where: { scope: 'GLOBAL', isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (globalRule) {
    return { rule: globalRule, levelLabel: 'Global' };
  }

  return { rule: null, levelLabel: 'Padrão' };
}

function buildSystemPrompt(
  rule: AiRule | null,
  contactName: string | null
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

async function callGemini(
  apiKey: string,
  model: string,
  systemPrompt: string,
  turns: ChatTurn[]
): Promise<string> {
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY não configurada. Adicione sua chave gratuita do Google AI Studio em Configurações ou no .env.'
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // Gemini espera alternância / pelo menos 1 turno user
  const contents = turns.map((t) => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.content }],
  }));

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Olá' }] });
  }

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
        maxOutputTokens: 600,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Erro Gemini API (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text || '')
    .join('')
    .trim();

  if (!text) {
    throw new Error('A API Gemini retornou uma resposta vazia.');
  }

  return text;
}

async function callOllama(
  baseUrl: string,
  model: string,
  systemPrompt: string,
  turns: ChatTurn[]
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
  };

  const text = data.message?.content?.trim();
  if (!text) {
    throw new Error('O Ollama retornou uma resposta vazia.');
  }

  return text;
}

async function invokeProvider(
  systemPrompt: string,
  turns: ChatTurn[]
): Promise<string> {
  const settings = await getEffectiveSettings();
  const provider = settings.aiProvider || config.aiProvider;

  if (provider === 'ollama') {
    const baseUrl = settings.ollamaBaseUrl || config.ollamaBaseUrl;
    const model = settings.ollamaModel || config.ollamaModel;
    return callOllama(baseUrl, model, systemPrompt, turns);
  }

  const apiKey = settings.geminiApiKey || config.geminiApiKey;
  const model = settings.geminiModel || config.geminiModel;
  return callGemini(apiKey, model, systemPrompt, turns);
}

export async function generateConversationReply(
  conversationId: string
): Promise<AiReplyResult> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
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
    conversation.contactId,
    conversation.activeRuleId
  );

  const systemPrompt = buildSystemPrompt(rule, conversation.contact.name);

  // Ordena cronologicamente e mescla mensagens consecutivas do mesmo papel
  const ordered = [...conversation.messages].reverse();
  const turns: ChatTurn[] = [];
  for (const msg of ordered) {
    const role: 'user' | 'assistant' =
      msg.direction === 'INBOUND' ? 'user' : 'assistant';
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n${msg.body}`;
    } else {
      turns.push({ role, content: msg.body });
    }
  }

  const rawText = await invokeProvider(systemPrompt, turns);
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
  conversationId: string
): Promise<string> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
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

  const summary = await invokeProvider(systemPrompt, [
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
    'AI',
    `Resumo gerado por IA para ${conversation.contact.name || conversation.contact.phone}`,
    'INFO'
  );

  return summary;
}

export async function generateDailyExecutiveSummary(): Promise<string> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [todayMessages, activeConversations, campaigns] = await Promise.all([
    prisma.message.findMany({
      where: { createdAt: { gte: startOfDay } },
      include: { conversation: { include: { contact: true } } },
      orderBy: { createdAt: 'desc' },
      take: 120,
    }),
    prisma.conversation.count({
      where: { lastMessageAt: { gte: startOfDay } },
    }),
    prisma.campaign.findMany({
      where: { updatedAt: { gte: startOfDay } },
      select: { name: true, status: true, sentCount: true, failedCount: true, totalCount: true },
    }),
  ]);

  if (todayMessages.length === 0 && campaigns.length === 0) {
    const emptySummary =
      'Nenhuma mensagem ou campanha registrada hoje até o momento.';
    await prisma.appSettings.update({
      where: { id: 1 },
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

  const summary = await invokeProvider(systemPrompt, [
    {
      role: 'user',
      content: `Dados do dia:\n${statsText}\n\nAmostra recente das conversas:\n${sampleTranscript}`,
    },
  ]);

  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      lastDailySummary: summary,
      lastDailySummaryAt: new Date(),
    },
  });

  await logActivity('AI', 'Resumo executivo diário gerado pela IA.', 'SUCCESS');
  return summary;
}

export async function generateMessageVariation(
  renderedTemplate: string,
  contactName: string
): Promise<string> {
  try {
    const systemPrompt =
      'Você reescreve mensagens curtas de WhatsApp criando pequenas variações naturais na saudação e na fraseologia para evitar textos idênticos em massa. Mantenha 100% do sentido original, o nome do contato e qualquer link/informação importante. Retorne APENAS a mensagem final, sem aspas nem explicações.';

    const varied = await invokeProvider(systemPrompt, [
      {
        role: 'user',
        content: `Crie uma variação natural e humana desta mensagem para ${contactName}:\n\n${renderedTemplate}`,
      },
    ]);

    return varied || renderedTemplate;
  } catch {
    // Fallback seguro para nunca travar campanha se a IA estiver indisponível
    return renderedTemplate;
  }
}

export async function checkAiHealth(): Promise<AiHealthStatus> {
  const settings = await getEffectiveSettings();
  const provider = (settings.aiProvider || config.aiProvider) as
    | 'gemini'
    | 'ollama';

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

  const apiKey = settings.geminiApiKey || config.geminiApiKey;
  const model = settings.geminiModel || config.geminiModel;

  if (!apiKey) {
    return {
      provider: 'gemini',
      model,
      ready: false,
      details:
        'Chave GEMINI_API_KEY não configurada (configure em Configurações ou .env).',
    };
  }

  return {
    provider: 'gemini',
    model,
    ready: true,
    details: 'Google Gemini API (Free Tier) configurado e pronto.',
  };
}

export async function testAiConnection(): Promise<{
  ok: boolean;
  reply?: string;
  error?: string;
}> {
  try {
    const reply = await invokeProvider(
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
