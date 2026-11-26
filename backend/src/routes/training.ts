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
