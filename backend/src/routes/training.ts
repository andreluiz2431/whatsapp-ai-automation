import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { logActivity } from '../services/activityLog';
import {
  ChatTurn,
  extractTrainingFromConversation,
  extractTrainingFromTranscript,
  simulateTrainingChat,
} from '../services/aiService';
import { parseWhatsAppExport } from '../services/chatImportParser';

export const trainingRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

interface ParsedTrainingImportItem {
  customerMessage: string;
  idealResponse: string;
  feedbackNote: string | null;
  ruleName: string | null;
  isActive: boolean;
}

const TEMPLATE_EXAMPLES: Array<{
  customerMessage: string;
  idealResponse: string;
  feedbackNote: string;
  ruleName: string;
  isActive: boolean;
}> = [
  {
    customerMessage: 'Qual o valor e como funciona o pagamento?',
    idealResponse:
      'Temos opções a partir de R$ 97/mês. Aceitamos Pix com 5% de desconto ou cartão de crédito em até 6x sem juros. Qual plano faz mais sentido para você?',
    feedbackNote: 'Sempre mencionar Pix e parcelamento de forma objetiva.',
    ruleName: 'Global',
    isActive: true,
  },
  {
    customerMessage: 'Vocês atendem em qual horário?',
    idealResponse:
      'Nosso atendimento humano funciona de segunda a sexta, das 9h às 18h, mas posso adiantar suas dúvidas por aqui agora mesmo!',
    feedbackNote: 'Informar horário comercial sem encerrar o assunto.',
    ruleName: 'Global',
    isActive: true,
  },
  {
    customerMessage: 'Quero cancelar ou falar com um atendente humano.',
    idealResponse:
      'Claro! Vou encaminhar sua conversa agora mesmo para um de nossos especialistas humanos te ajudar. [TRANSFERIR_HUMANO]',
    feedbackNote: 'Acionar transferência para humano imediatamente.',
    ruleName: 'Global',
    isActive: true,
  },
];

function escapeCsvCell(value: string): string {
  const safe = String(value ?? '');
  if (/[;"\n\r,]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function buildExamplesCsv(
  rows: Array<{
    customerMessage: string;
    idealResponse: string;
    feedbackNote?: string | null;
    ruleName?: string | null;
    isActive?: boolean;
  }>
): string {
  const header = 'mensagem_cliente;resposta_ideal;observacao;regra;ativo';
  const lines = rows.map((r) =>
    [
      escapeCsvCell(r.customerMessage),
      escapeCsvCell(r.idealResponse),
      escapeCsvCell(r.feedbackNote || ''),
      escapeCsvCell(r.ruleName || 'Global'),
      r.isActive === false ? 'false' : 'true',
    ].join(';')
  );
  // UTF-8 BOM para abrir com acentuação perfeita no Excel
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

function parseCsvRows(raw: string): string[][] {
  const clean = raw.replace(/^\uFEFF/, '');
  // Detecta delimitador predominante na primeira linha (ponto-e-vírgula ou vírgula)
  const firstLine = clean.split(/\r?\n/)[0] || '';
  const semiCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semiCount >= commaCount ? ';' : ',';

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentCell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentCell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      currentRow.push(currentCell);
      currentCell = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function parseBoolValue(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  const s = String(val ?? 'true').trim().toLowerCase();
  if (['false', '0', 'nao', 'não', 'no', 'inativo', 'pausado'].includes(s)) {
    return false;
  }
  return true;
}

function normalizeHeaderKey(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseTrainingExamplesPayload(
  rawText: string,
  filename = ''
): { items: ParsedTrainingImportItem[]; skipped: number } {
  const trimmed = rawText.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return { items: [], skipped: 0 };
  }

  const looksJson =
    filename.toLowerCase().endsWith('.json') ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');

  if (looksJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        'Arquivo JSON inválido. Baixe o modelo JSON aceito para conferir a estrutura correta.'
      );
    }

    const list = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === 'object' &&
          Array.isArray((parsed as { examples?: unknown[] }).examples)
        ? (parsed as { examples: unknown[] }).examples
        : parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { roteiros?: unknown[] }).roteiros)
          ? (parsed as { roteiros: unknown[] }).roteiros
          : null;

    if (!list) {
      throw new Error(
        'Estrutura JSON não reconhecida. Use um array de objetos ou { "examples": [...] }.'
      );
    }

    const items: ParsedTrainingImportItem[] = [];
    let skipped = 0;

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') {
        skipped++;
        continue;
      }
      const rec = entry as Record<string, unknown>;
      const customerMessage = String(
        rec.customerMessage ??
          rec.mensagem_cliente ??
          rec.mensagemCliente ??
          rec.pergunta ??
          rec.cliente ??
          ''
      ).trim();
      const idealResponse = String(
        rec.idealResponse ??
          rec.resposta_ideal ??
          rec.respostaIdeal ??
          rec.resposta ??
          ''
      ).trim();

      if (!customerMessage || !idealResponse) {
        skipped++;
        continue;
      }

      const rawNote =
        rec.feedbackNote ?? rec.observacao ?? rec.nota ?? rec.obs ?? '';
      const rawRule =
        rec.ruleName ?? rec.regra ?? rec.fluxo ?? rec.rule ?? '';
      const rawActive = rec.isActive ?? rec.ativo ?? true;

      items.push({
        customerMessage,
        idealResponse,
        feedbackNote: String(rawNote || '').trim() || null,
        ruleName: String(rawRule || '').trim() || null,
        isActive: parseBoolValue(rawActive),
      });
    }

    return { items, skipped };
  }

  // CSV
  const rows = parseCsvRows(trimmed);
  if (rows.length === 0) return { items: [], skipped: 0 };

  const headers = rows[0].map(normalizeHeaderKey);
  const idxCustomer = headers.findIndex((h) =>
    [
      'mensagemcliente',
      'customermessage',
      'cliente',
      'pergunta',
      'entrada',
    ].includes(h)
  );
  const idxIdeal = headers.findIndex((h) =>
    ['respostaideal', 'idealresponse', 'resposta', 'saida'].includes(h)
  );
  const idxNote = headers.findIndex((h) =>
    ['observacao', 'feedbacknote', 'nota', 'obs', 'regraextra'].includes(h)
  );
  const idxRule = headers.findIndex((h) =>
    ['regra', 'rulename', 'fluxo', 'persona', 'escopo'].includes(h)
  );
  const idxActive = headers.findIndex((h) =>
    ['ativo', 'isactive', 'status'].includes(h)
  );

  const hasHeaderRow = idxCustomer !== -1 && idxIdeal !== -1;
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;
  const colCustomer = hasHeaderRow ? idxCustomer : 0;
  const colIdeal = hasHeaderRow ? idxIdeal : 1;
  const colNote = hasHeaderRow ? idxNote : 2;
  const colRule = hasHeaderRow ? idxRule : 3;
  const colActive = hasHeaderRow ? idxActive : 4;

  const items: ParsedTrainingImportItem[] = [];
  let skipped = 0;

  for (const row of dataRows) {
    const customerMessage = String(row[colCustomer] ?? '').trim();
    const idealResponse = String(row[colIdeal] ?? '').trim();
    if (!customerMessage || !idealResponse) {
      skipped++;
      continue;
    }

    const feedbackNote =
      colNote >= 0 ? String(row[colNote] ?? '').trim() || null : null;
    const ruleName =
      colRule >= 0 ? String(row[colRule] ?? '').trim() || null : null;
    const isActive =
      colActive >= 0 && row[colActive] !== undefined && row[colActive].trim() !== ''
        ? parseBoolValue(row[colActive])
        : true;

    items.push({
      customerMessage,
      idealResponse,
      feedbackNote,
      ruleName,
      isActive,
    });
  }

  return { items, skipped };
}

trainingRouter.get('/overview', async (req, res) => {
  try {
    const userId = req.user!.id;
    const [examples, rules, conversations] = await Promise.all([
      prisma.aiTrainingExample.findMany({
        where: { userId },
        include: { rule: { select: { id: true, name: true, scope: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.aiRule.findMany({
        where: { userId },
        orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          name: true,
          scope: true,
          isActive: true,
          objective: true,
          knowledgeBase: true,
        },
      }),
      prisma.conversation.findMany({
        where: { userId },
        orderBy: { lastMessageAt: 'desc' },
        take: 40,
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          _count: { select: { messages: true } },
        },
      }),
    ]);

    res.json({ examples, rules, conversations });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao carregar dados de treinamento.',
    });
  }
});

trainingRouter.get('/examples/template', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();

  if (format === 'json') {
    const payload = {
      version: 1,
      description:
        'Modelo oficial de importação de roteiros de treinamento do ZapFlow AI. Preencha "examples" com seus roteiros (use ruleName "Global" ou o nome exato de uma regra em Fluxos & Personas IA).',
      examples: TEMPLATE_EXAMPLES,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="modelo-roteiros-treinamento-zapflow.json"'
    );
    res.send(JSON.stringify(payload, null, 2));
    return;
  }

  const csv = buildExamplesCsv(TEMPLATE_EXAMPLES);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="modelo-roteiros-treinamento-zapflow.csv"'
  );
  res.send(csv);
});

trainingRouter.get('/examples/export', async (req, res) => {
  try {
    const userId = req.user!.id;
    const format = String(req.query.format || 'json').toLowerCase();
    const examples = await prisma.aiTrainingExample.findMany({
      where: { userId },
      include: { rule: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const dateTag = new Date().toISOString().slice(0, 10);
    const normalized = examples.map((ex) => ({
      customerMessage: ex.customerMessage,
      idealResponse: ex.idealResponse,
      feedbackNote: ex.feedbackNote || '',
      ruleName: ex.rule?.name || 'Global',
      isActive: ex.isActive,
      source: ex.source,
    }));

    if (format === 'csv') {
      const csv = buildExamplesCsv(normalized);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="roteiros-treinamento-zapflow-${dateTag}.csv"`
      );
      res.send(csv);
      return;
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      total: normalized.length,
      examples: normalized,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="roteiros-treinamento-zapflow-${dateTag}.json"`
    );
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao exportar roteiros de treinamento.',
    });
  }
});

trainingRouter.post(
  '/examples/import',
  upload.single('file'),
  async (req, res) => {
    try {
      const userId = req.user!.id;
      const mode =
        String(req.body?.mode || 'KEEP').toUpperCase() === 'OVERWRITE'
          ? 'OVERWRITE'
          : 'KEEP';
      const defaultRuleIdRaw = String(req.body?.defaultRuleId || '').trim();
      let rawText = String(req.body?.text || '');
      const filename = req.file?.originalname || '';

      if (req.file) {
        rawText = req.file.buffer.toString('utf-8');
      }

      if (!rawText.trim()) {
        res.status(400).json({
          error:
            'Envie um arquivo (.csv ou .json) ou cole os roteiros no campo de texto.',
        });
        return;
      }

      const { items, skipped } = parseTrainingExamplesPayload(rawText, filename);
      if (items.length === 0) {
        res.status(400).json({
          error:
            'Nenhum roteiro válido encontrado no arquivo. Baixe o modelo CSV ou JSON para verificar a estrutura aceita.',
        });
        return;
      }

      const userRules = await prisma.aiRule.findMany({
        where: { userId },
        select: { id: true, name: true },
      });

      let fallbackRuleId: string | null = null;
      if (defaultRuleIdRaw) {
        const owned = userRules.find((r) => r.id === defaultRuleIdRaw);
        if (!owned) {
          res.status(400).json({ error: 'Regra padrão selecionada é inválida.' });
          return;
        }
        fallbackRuleId = owned.id;
      }

      const ruleMap = new Map<string, string>();
      for (const r of userRules) {
        ruleMap.set(r.name.trim().toLowerCase(), r.id);
      }

      const recordsToCreate = items.slice(0, 500).map((item) => {
        let resolvedRuleId: string | null = fallbackRuleId;
        if (item.ruleName) {
          const lower = item.ruleName.trim().toLowerCase();
          if (lower === 'global' || lower === 'todas' || lower === 'todos') {
            resolvedRuleId = null;
          } else if (ruleMap.has(lower)) {
            resolvedRuleId = ruleMap.get(lower) || fallbackRuleId;
          }
        }
        return {
          userId,
          ruleId: resolvedRuleId,
          customerMessage: item.customerMessage,
          idealResponse: item.idealResponse,
          feedbackNote: item.feedbackNote,
          source: 'IMPORT',
          isActive: item.isActive,
        };
      });

      let deletedCount = 0;
      await prisma.$transaction(async (tx) => {
        if (mode === 'OVERWRITE') {
          const del = await tx.aiTrainingExample.deleteMany({
            where: { userId },
          });
          deletedCount = del.count;
        }
        await tx.aiTrainingExample.createMany({
          data: recordsToCreate,
        });
      });

      await logActivity(
        userId,
        'AI',
        `Importação de roteiros de treinamento concluída (${recordsToCreate.length} importado(s) • modo: ${
          mode === 'OVERWRITE'
            ? `Sobrescrever (${deletedCount} anterior(es) removido(s))`
            : 'Manter existentes'
        }).`,
        'SUCCESS'
      );

      res.status(201).json({
        ok: true,
        mode,
        importedCount: recordsToCreate.length,
        deletedCount,
        skippedCount: skipped,
      });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error
            ? err.message
            : 'Erro ao importar roteiros de treinamento.',
      });
    }
  }
);

trainingRouter.post('/examples', async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      ruleId = null,
      customerMessage,
      idealResponse,
      feedbackNote = null,
      source = 'MANUAL',
    } = req.body as {
      ruleId?: string | null;
      customerMessage?: string;
      idealResponse?: string;
      feedbackNote?: string | null;
      source?: string;
    };

    if (!customerMessage?.trim() || !idealResponse?.trim()) {
      res.status(400).json({
        error: 'Informe a mensagem do cliente e a resposta ideal da IA.',
      });
      return;
    }

    if (ruleId) {
      const owned = await prisma.aiRule.findFirst({
        where: { id: ruleId, userId },
      });
      if (!owned) {
        res.status(400).json({ error: 'Regra de IA inválida.' });
        return;
      }
    }

    const example = await prisma.aiTrainingExample.create({
      data: {
        userId,
        ruleId: ruleId || null,
        customerMessage: customerMessage.trim(),
        idealResponse: idealResponse.trim(),
        feedbackNote: feedbackNote?.trim() || null,
        source: String(source || 'MANUAL'),
        isActive: true,
      },
      include: { rule: { select: { id: true, name: true, scope: true } } },
    });

    await logActivity(
      userId,
      'AI',
      `Novo exemplo de treinamento salvo (${example.rule ? example.rule.name : 'Global'}).`,
      'SUCCESS'
    );

    res.status(201).json(example);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao salvar exemplo de treinamento.',
    });
  }
});

trainingRouter.put('/examples/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const existing = await prisma.aiTrainingExample.findFirst({
      where: { id: req.params.id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Exemplo não encontrado.' });
      return;
    }

    const { ruleId, customerMessage, idealResponse, feedbackNote, isActive } =
      req.body;

    const updated = await prisma.aiTrainingExample.update({
      where: { id: existing.id },
      data: {
        ...(ruleId !== undefined ? { ruleId: ruleId || null } : {}),
        ...(customerMessage !== undefined
          ? { customerMessage: String(customerMessage).trim() }
          : {}),
        ...(idealResponse !== undefined
          ? { idealResponse: String(idealResponse).trim() }
          : {}),
        ...(feedbackNote !== undefined
          ? { feedbackNote: String(feedbackNote || '').trim() || null }
          : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
      include: { rule: { select: { id: true, name: true, scope: true } } },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar exemplo.',
    });
  }
});

trainingRouter.delete('/examples/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    await prisma.aiTrainingExample.deleteMany({
      where: { id: req.params.id, userId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir exemplo.',
    });
  }
});

trainingRouter.post('/simulate', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { ruleId = null, messages = [] } = req.body as {
      ruleId?: string | null;
      messages?: ChatTurn[];
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Envie ao menos uma mensagem para simular.' });
      return;
    }

    const cleanTurns: ChatTurn[] = messages
      .filter((m) => m && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content.trim(),
      }));

    const result = await simulateTrainingChat(userId, ruleId, cleanTurns);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Erro ao simular resposta da IA.',
    });
  }
});

trainingRouter.post('/analyze-simulator', async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      messages = [],
      feedback = '',
      ruleId = null,
    } = req.body as {
      messages?: ChatTurn[];
      feedback?: string;
      ruleId?: string | null;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        error: 'Converse com a IA no simulador antes de extrair aprendizados.',
      });
      return;
    }

    const transcript = messages
      .map(
        (m) => `[${m.role === 'assistant' ? 'IA Atual' : 'Cliente/Treinador'}]: ${m.content}`
      )
      .join('\n');

    const result = await extractTrainingFromTranscript(
      userId,
      transcript,
      feedback,
      ruleId
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao analisar sessão de treinamento.',
    });
  }
});

trainingRouter.post('/analyze-conversation', async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      conversationId,
      feedback = '',
      ruleId = null,
    } = req.body as {
      conversationId?: string;
      feedback?: string;
      ruleId?: string | null;
    };

    if (!conversationId) {
      res.status(400).json({ error: 'Selecione uma conversa real para analisar.' });
      return;
    }

    const result = await extractTrainingFromConversation(
      userId,
      conversationId,
      feedback,
      ruleId
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao analisar histórico da conversa.',
    });
  }
});

trainingRouter.post('/analyze-raw', upload.single('file'), async (req, res) => {
  try {
    const userId = req.user!.id;
    let rawText = String(req.body?.text || '');
    if (req.file) {
      rawText = req.file.buffer.toString('utf-8');
    }
    const feedback = String(req.body?.feedback || '');
    const ruleId = req.body?.ruleId ? String(req.body.ruleId) : null;

    if (!rawText.trim()) {
      res.status(400).json({
        error: 'Envie um arquivo .txt ou cole o histórico da conversa para analisar.',
      });
      return;
    }

    const parsed = parseWhatsAppExport(rawText);
    const transcript =
      parsed.messages.length > 0
        ? parsed.messages
            .slice(-120)
            .map((m) => `[${m.sender}]: ${m.body}`)
            .join('\n')
        : rawText.slice(-12000);

    const result = await extractTrainingFromTranscript(
      userId,
      transcript,
      feedback,
      ruleId
    );

    await logActivity(
      userId,
      'AI',
      `Histórico externo importado e analisado para treinamento (${result.suggestedExamples.length} exemplo(s) sugerido(s)).`,
      'SUCCESS'
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao analisar conversa importada.',
    });
  }
});

trainingRouter.post('/apply-knowledge', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { ruleId, knowledgeAddition } = req.body as {
      ruleId?: string;
      knowledgeAddition?: string;
    };

    if (!ruleId || !knowledgeAddition?.trim()) {
      res.status(400).json({
        error: 'Selecione uma regra e informe o conhecimento a incorporar.',
      });
      return;
    }

    const rule = await prisma.aiRule.findFirst({ where: { id: ruleId, userId } });
    if (!rule) {
      res.status(404).json({ error: 'Regra de IA não encontrada.' });
      return;
    }

    const updatedKnowledge = [rule.knowledgeBase.trim(), knowledgeAddition.trim()]
      .filter(Boolean)
      .join('\n\n');

    const updated = await prisma.aiRule.update({
      where: { id: rule.id },
      data: { knowledgeBase: updatedKnowledge },
    });

    await logActivity(
      userId,
      'AI',
      `Base de conhecimento da regra "${rule.name}" atualizada via Treinamento IA.`,
      'SUCCESS'
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao incorporar conhecimento na regra.',
    });
  }
});
