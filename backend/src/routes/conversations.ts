import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { emitUserEvent, logActivity } from '../services/activityLog';
import {
  generateConversationSummary,
  resolveRuleForContact,
} from '../services/aiService';
import { parseWhatsAppExport } from '../services/chatImportParser';
import {
  normalizePhoneAndJid,
  whatsappManager,
} from '../services/whatsappService';

export const conversationsRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

conversationsRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const conversations = await prisma.conversation.findMany({
      where: { userId },
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
          userId,
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
    const userId = req.user!.id;
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
      where: { userId_jid: { userId, jid } },
      update: name ? { name: name.trim() } : {},
      create: { userId, phone, jid, name: name?.trim() || null },
    });

    const conversation = await prisma.conversation.upsert({
      where: { contactId: contact.id },
      update: {},
      create: {
        userId,
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
      await whatsappManager
        .getSession(userId)
        .sendManualMessage(conversation.id, message.trim());
    }

    emitUserEvent(userId, 'conversation:updated', conversation);
    res.status(201).json(conversation);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao iniciar conversa.',
    });
  }
});

conversationsRouter.post(
  '/import-preview',
  upload.single('file'),
  (req, res) => {
    try {
      let rawText = String(req.body?.text || '');
      if (req.file) {
        rawText = req.file.buffer.toString('utf-8');
      }
      if (!rawText.trim()) {
        res.status(400).json({
          error: 'Envie um arquivo .txt exportado do WhatsApp ou cole o texto da conversa.',
        });
        return;
      }

      const parsed = parseWhatsAppExport(rawText);
      res.json({
        totalMessages: parsed.messages.length,
        speakers: parsed.speakers,
        sample: parsed.messages.slice(0, 6),
        messages: parsed.messages,
      });
    } catch (err) {
      res.status(500).json({
        error:
          err instanceof Error
            ? err.message
            : 'Erro ao interpretar arquivo de conversa.',
      });
    }
  }
);

conversationsRouter.post('/import', async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      phone: rawPhone,
      contactName,
      mySenderName,
      mode = 'MANUAL',
      autoSummarize = false,
      rawText,
      messages: providedMessages,
    } = req.body as {
      phone?: string;
      contactName?: string;
      mySenderName?: string;
      mode?: 'AUTO' | 'MANUAL';
      autoSummarize?: boolean;
      rawText?: string;
      messages?: Array<{ sender: string; body: string; timestamp?: string | null }>;
    };

    if (!rawPhone || rawPhone.replace(/\D/g, '').length < 8) {
      res.status(400).json({
        error: 'Informe o número de WhatsApp válido do contato (com DDD).',
      });
      return;
    }

    let parsedMessages = Array.isArray(providedMessages)
      ? providedMessages
      : [];

    if (parsedMessages.length === 0 && rawText?.trim()) {
      parsedMessages = parseWhatsAppExport(rawText).messages;
    }

    if (parsedMessages.length === 0) {
      res.status(400).json({
        error:
          'Nenhuma mensagem reconhecida no texto/arquivo. Use a exportação .txt do WhatsApp ou o formato "Nome: mensagem".',
      });
      return;
    }

    // Limita a 1000 mensagens mais recentes por importação para manter o banco leve
    const trimmed = parsedMessages.slice(-1000);
    const normalizedMe = (mySenderName || '').trim().toLowerCase();

    // Tenta inferir nome do contato a partir do outro participante se não informado
    const inferredContactName =
      contactName?.trim() ||
      trimmed.find((m) => m.sender.trim().toLowerCase() !== normalizedMe)?.sender ||
      null;

    const { phone, jid } = normalizePhoneAndJid(rawPhone);
    const contact = await prisma.contact.upsert({
      where: { userId_jid: { userId, jid } },
      update: inferredContactName ? { name: inferredContactName } : {},
      create: { userId, phone, jid, name: inferredContactName },
    });

    const baseNow = Date.now();
    const messageRecords = trimmed.map((m, idx) => {
      const isMe =
        normalizedMe.length > 0 &&
        m.sender.trim().toLowerCase() === normalizedMe;
      const createdAt = m.timestamp
        ? new Date(m.timestamp)
        : new Date(baseNow - (trimmed.length - idx) * 60 * 1000);

      return {
        direction: isMe ? 'OUTBOUND' : 'INBOUND',
        senderType: isMe ? 'HUMAN' : 'CONTACT',
        body: m.body.trim(),
        status: isMe ? 'SENT' : 'DELIVERED',
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
      };
    });

    const lastMsg = messageRecords[messageRecords.length - 1];

    const conversation = await prisma.conversation.upsert({
      where: { contactId: contact.id },
      update: {
        mode: mode === 'AUTO' ? 'AUTO' : 'MANUAL',
        lastMessageAt: lastMsg.createdAt,
        lastMessagePreview: lastMsg.body.slice(0, 120),
      },
      create: {
        userId,
        contactId: contact.id,
        mode: mode === 'AUTO' ? 'AUTO' : 'MANUAL',
        lastMessageAt: lastMsg.createdAt,
        lastMessagePreview: lastMsg.body.slice(0, 120),
        unreadCount: 0,
      },
    });

    await prisma.message.createMany({
      data: messageRecords.map((rec) => ({
        conversationId: conversation.id,
        ...rec,
      })),
    });

    if (autoSummarize) {
      void generateConversationSummary(userId, conversation.id).catch(() => {});
    }

    const fullConv = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: {
        contact: { include: { tags: { include: { tag: true } } } },
        activeRule: true,
      },
    });

    emitUserEvent(userId, 'conversation:updated', fullConv);
    emitUserEvent(userId, 'dashboard:refresh', {});
    await logActivity(
      userId,
      'WHATSAPP',
      `Conversa com ${contact.name || contact.phone} importada (${messageRecords.length} mensagem(ns)).`,
      'SUCCESS'
    );

    res.status(201).json({
      conversation: fullConv,
      importedCount: messageRecords.length,
    });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Erro ao importar conversa.',
    });
  }
});

conversationsRouter.get('/:id/messages', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const conv = await prisma.conversation.findFirst({
      where: { id, userId },
    });
    if (!conv) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

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
    const userId = req.user!.id;
    const { id } = req.params;
    const body = String(req.body?.body || '').trim();
    if (!body) {
      res.status(400).json({ error: 'A mensagem não pode estar vazia.' });
      return;
    }

    const result = await whatsappManager
      .getSession(userId)
      .sendManualMessage(id, body);
    res.json(result);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao enviar mensagem.',
    });
  }
});

conversationsRouter.patch('/:id/mode', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const existing = await prisma.conversation.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }

    const mode = req.body?.mode === 'MANUAL' ? 'MANUAL' : 'AUTO';
    const activeRuleId =
      req.body?.activeRuleId !== undefined ? req.body.activeRuleId : undefined;

    if (activeRuleId) {
      const rule = await prisma.aiRule.findFirst({
        where: { id: activeRuleId, userId },
      });
      if (!rule) {
        res.status(400).json({ error: 'Regra de IA inválida.' });
        return;
      }
    }

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
      userId,
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

    emitUserEvent(userId, 'conversation:updated', enriched);
    await logActivity(
      userId,
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
    const userId = req.user!.id;
    const { id } = req.params;
    const summary = await generateConversationSummary(userId, id);
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
    const userId = req.user!.id;
    const { id } = req.params;
    const { name, notes, tagIds } = req.body as {
      name?: string;
      notes?: string;
      tagIds?: string[];
    };

    const conv = await prisma.conversation.findFirst({
      where: { id, userId },
    });
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
      const validTags = await prisma.tag.findMany({
        where: { id: { in: tagIds }, userId },
        select: { id: true },
      });
      await prisma.contactTag.deleteMany({
        where: { contactId: conv.contactId },
      });
      for (const t of validTags) {
        await prisma.contactTag.create({
          data: { contactId: conv.contactId, tagId: t.id },
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
        userId,
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
      emitUserEvent(userId, 'conversation:updated', enriched);
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
