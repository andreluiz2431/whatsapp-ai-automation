import { Router } from 'express';
import { prisma } from '../db';
import { emitSocketEvent, logActivity } from '../services/activityLog';
import {
  generateConversationSummary,
  resolveRuleForContact,
} from '../services/aiService';
import {
  normalizePhoneAndJid,
  whatsappService,
} from '../services/whatsappService';

export const conversationsRouter = Router();

conversationsRouter.get('/', async (_req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: {
          include: {
            tags: { include: { tag: true } },
          },
        },
        activeRule: true,
      },
    });

    const enriched = await Promise.all(
      conversations.map(async (conv) => {
        const resolved = await resolveRuleForContact(
          conv.contactId,
          conv.activeRuleId
        );
        return {
          ...conv,
          resolvedRule: resolved.rule
            ? {
                id: resolved.rule.id,
                name: resolved.rule.name,
                scope: resolved.rule.scope,
                levelLabel: resolved.levelLabel,
              }
            : null,
        };
      })
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao listar conversas.',
    });
  }
});

conversationsRouter.post('/start', async (req, res) => {
  try {
    const { phone: rawPhone, name, message } = req.body as {
      phone?: string;
      name?: string;
      message?: string;
    };

    if (!rawPhone || rawPhone.replace(/\D/g, '').length < 8) {
      res.status(400).json({ error: 'Informe um número de telefone válido.' });
      return;
    }

    const { phone, jid } = normalizePhoneAndJid(rawPhone);
    const contact = await prisma.contact.upsert({
      where: { jid },
      update: name ? { name: name.trim() } : {},
      create: { phone, jid, name: name?.trim() || null },
    });

    const conversation = await prisma.conversation.upsert({
      where: { contactId: contact.id },
      update: {},
      create: {
        contactId: contact.id,
        mode: 'MANUAL',
        lastMessageAt: new Date(),
      },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        activeRule: true,
      },
    });

    if (message && message.trim()) {
      await whatsappService.sendManualMessage(conversation.id, message.trim());
    }

    emitSocketEvent('conversation:updated', conversation);
    res.status(201).json(conversation);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao iniciar conversa.',
    });
  }
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    await prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
    });

    res.json(messages);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao carregar mensagens.',
    });
  }
});

conversationsRouter.post('/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const body = String(req.body?.body || '').trim();
    if (!body) {
      res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
      return;
    }

    const result = await whatsappService.sendManualMessage(id, body);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao enviar mensagem.',
    });
  }
});

conversationsRouter.patch('/:id/mode', async (req, res) => {
  try {
    const { id } = req.params;
    const mode = req.body?.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const activeRuleId =
      req.body?.activeRuleId !== undefined ? req.body.activeRuleId : undefined;

    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        mode,
        ...(activeRuleId !== undefined ? { activeRuleId: activeRuleId || null } : {}),
      },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        activeRule: true,
      },
    });

    const resolved = await resolveRuleForContact(
      updated.contactId,
      updated.activeRuleId
    );
    const enriched = {
      ...updated,
      resolvedRule: resolved.rule
        ? {
            id: resolved.rule.id,
            name: resolved.rule.name,
            scope: resolved.rule.scope,
            levelLabel: resolved.levelLabel,
          }
        : null,
    };

    emitSocketEvent('conversation:updated', enriched);
    await logActivity(
      'SYSTEM',
      `Conversa com ${updated.contact.name || updated.contact.phone} alterada para modo ${
        mode === 'AUTO' ? 'Automático (IA)' : 'Manual (Humano)'
      }.`,
      'INFO'
    );

    res.json(enriched);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar modo.',
    });
  }
});

conversationsRouter.post('/:id/summary', async (req, res) => {
  try {
    const { id } = req.params;
    const summary = await generateConversationSummary(id);
    res.json({ summary, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao gerar resumo da conversa.',
    });
  }
});

conversationsRouter.patch('/:id/contact', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, notes, tagIds } = req.body as {
      name?: string;
      notes?: string;
      tagIds?: string[];
    };

    const conv = await prisma.conversation.findUnique({ where: { id } });
    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

    await prisma.contact.update({
      where: { id: conv.contactId },
      data: {
        ...(name !== undefined ? { name: name.trim() || null } : {}),
        ...(notes !== undefined ? { notes: notes.trim() || null } : {}),
      },
    });

    if (Array.isArray(tagIds)) {
      await prisma.contactTag.deleteMany({
        where: { contactId: conv.contactId },
      });
      for (const tagId of tagIds) {
        await prisma.contactTag.create({
          data: { contactId: conv.contactId, tagId },
        });
      }
    }

    const updated = await prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        activeRule: true,
      },
    });

    if (updated) {
      const resolved = await resolveRuleForContact(
        updated.contactId,
        updated.activeRuleId
      );
      const enriched = {
        ...updated,
        resolvedRule: resolved.rule
          ? {
              id: resolved.rule.id,
              name: resolved.rule.name,
              scope: resolved.rule.scope,
              levelLabel: resolved.levelLabel,
            }
          : null,
      };
      emitSocketEvent('conversation:updated', enriched);
      res.json(enriched);
      return;
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar contato.',
    });
  }
});
