import { Router } from 'express';
import { prisma } from '../db';
import { logActivity } from '../services/activityLog';
import { normalizePhoneAndJid } from '../services/whatsappService';

export const rulesRouter = Router();

rulesRouter.get('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const [rules, tags, contacts] = await Promise.all([
      prisma.aiRule.findMany({
        where: { userId },
        include: { tag: true, contact: true },
        orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
      }),
      prisma.tag.findMany({
        where: { userId },
        orderBy: { name: 'asc' },
        include: { _count: { select: { contacts: true } } },
      }),
      prisma.contact.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    ]);

    res.json({ rules, tags, contacts });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao carregar regras de IA.',
    });
  }
});

rulesRouter.post('/', async (req, res) => {
  try {
    const userId = req.user!.id;
    const {
      name,
      scope,
      isActive = true,
      tagId,
      contactId,
      contactPhone,
      contactName,
      objective,
      toneOfVoice,
      responseTone,
      trainingFlexibility,
      responseLength,
      emojiStyle,
      knowledgeBase,
      stopCondition,
    } = req.body;

    if (!name || !scope || !objective) {
      res.status(400).json({
        error: 'Nome, nível (escopo) e objetivo da conversa são obrigatórios.',
      });
      return;
    }

    let resolvedContactId: string | null = contactId || null;

    if (scope === 'CONTACT') {
      if (resolvedContactId) {
        const owned = await prisma.contact.findFirst({
          where: { id: resolvedContactId, userId },
        });
        if (!owned) {
          res.status(400).json({ error: 'Contato inválido.' });
          return;
        }
      } else if (contactPhone) {
        const { phone, jid } = normalizePhoneAndJid(String(contactPhone));
        const contact = await prisma.contact.upsert({
          where: { userId_jid: { userId, jid } },
          update: contactName ? { name: String(contactName).trim() } : {},
          create: {
            userId,
            phone,
            jid,
            name: contactName ? String(contactName).trim() : null,
          },
        });
        resolvedContactId = contact.id;
      }
    }

    if (scope === 'TAG') {
      if (!tagId) {
        res.status(400).json({ error: 'Selecione um Grupo/Tag para esta regra.' });
        return;
      }
      const ownedTag = await prisma.tag.findFirst({
        where: { id: String(tagId), userId },
      });
      if (!ownedTag) {
        res.status(400).json({ error: 'Grupo/Tag inválido.' });
        return;
      }
    }

    if (scope === 'CONTACT' && !resolvedContactId) {
      res.status(400).json({
        error: 'Selecione um contato ou informe o número para uma regra Individual.',
      });
      return;
    }

    const rule = await prisma.aiRule.create({
      data: {
        userId,
        name: String(name).trim(),
        scope: String(scope),
        isActive: Boolean(isActive),
        tagId: scope === 'TAG' ? String(tagId) : null,
        contactId: scope === 'CONTACT' ? resolvedContactId : null,
        objective: String(objective).trim(),
        toneOfVoice: String(toneOfVoice || '').trim(),
        responseTone: responseTone ? String(responseTone).trim().toUpperCase() : null,
        trainingFlexibility: trainingFlexibility
          ? String(trainingFlexibility).trim().toUpperCase()
          : null,
        responseLength: responseLength
          ? String(responseLength).trim().toUpperCase()
          : null,
        emojiStyle: emojiStyle ? String(emojiStyle).trim().toUpperCase() : null,
        knowledgeBase: String(knowledgeBase || '').trim(),
        stopCondition: String(stopCondition || '').trim(),
      },
      include: { tag: true, contact: true },
    });

    await logActivity(
      userId,
      'AI',
      `Nova regra de IA criada: "${rule.name}" (${rule.scope}).`,
      'SUCCESS'
    );
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao criar regra de IA.',
    });
  }
});

rulesRouter.put('/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const existing = await prisma.aiRule.findFirst({ where: { id, userId } });
    if (!existing) {
      res.status(404).json({ error: 'Regra não encontrada.' });
      return;
    }

    const {
      name,
      scope,
      isActive,
      tagId,
      contactId,
      objective,
      toneOfVoice,
      responseTone,
      trainingFlexibility,
      responseLength,
      emojiStyle,
      knowledgeBase,
      stopCondition,
    } = req.body;

    const updated = await prisma.aiRule.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name: String(name).trim() } : {}),
        ...(scope !== undefined ? { scope: String(scope) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
        ...(scope === 'TAG'
          ? { tagId: tagId || null, contactId: null }
          : scope === 'CONTACT'
            ? { contactId: contactId || null, tagId: null }
            : scope === 'GLOBAL'
              ? { tagId: null, contactId: null }
              : {}),
        ...(objective !== undefined ? { objective: String(objective).trim() } : {}),
        ...(toneOfVoice !== undefined
          ? { toneOfVoice: String(toneOfVoice).trim() }
          : {}),
        ...(responseTone !== undefined
          ? {
              responseTone: responseTone
                ? String(responseTone).trim().toUpperCase()
                : null,
            }
          : {}),
        ...(trainingFlexibility !== undefined
          ? {
              trainingFlexibility: trainingFlexibility
                ? String(trainingFlexibility).trim().toUpperCase()
                : null,
            }
          : {}),
        ...(responseLength !== undefined
          ? {
              responseLength: responseLength
                ? String(responseLength).trim().toUpperCase()
                : null,
            }
          : {}),
        ...(emojiStyle !== undefined
          ? {
              emojiStyle: emojiStyle
                ? String(emojiStyle).trim().toUpperCase()
                : null,
            }
          : {}),
        ...(knowledgeBase !== undefined
          ? { knowledgeBase: String(knowledgeBase).trim() }
          : {}),
        ...(stopCondition !== undefined
          ? { stopCondition: String(stopCondition).trim() }
          : {}),
      },
      include: { tag: true, contact: true },
    });

    await logActivity(userId, 'AI', `Regra de IA atualizada: "${updated.name}".`, 'INFO');
    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar regra.',
    });
  }
});

rulesRouter.delete('/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    const deleted = await prisma.aiRule.deleteMany({
      where: { id: req.params.id, userId },
    });
    if (deleted.count === 0) {
      res.status(404).json({ error: 'Regra não encontrada.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir regra.',
    });
  }
});

rulesRouter.post('/tags', async (req, res) => {
  try {
    const userId = req.user!.id;
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#10b981').trim();
    if (!name) {
      res.status(400).json({ error: 'Nome da tag é obrigatório.' });
      return;
    }
    const tag = await prisma.tag.create({
      data: { userId, name, color },
      include: { _count: { select: { contacts: true } } },
    });
    res.status(201).json(tag);
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao criar tag (verifique se já existe).',
    });
  }
});

rulesRouter.delete('/tags/:id', async (req, res) => {
  try {
    const userId = req.user!.id;
    await prisma.tag.deleteMany({
      where: { id: req.params.id, userId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir tag.',
    });
  }
});
