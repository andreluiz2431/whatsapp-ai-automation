import { Router } from 'express';
import { prisma } from '../db';
import { logActivity } from '../services/activityLog';
import { normalizePhoneAndJid } from '../services/whatsappService';

export const rulesRouter = Router();

rulesRouter.get('/', async (_req, res) => {
  try {
    const [rules, tags, contacts] = await Promise.all([
      prisma.aiRule.findMany({
        include: { tag: true, contact: true },
        orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }],
      }),
      prisma.tag.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { contacts: true } } },
      }),
      prisma.contact.findMany({
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

    if (scope === 'CONTACT' && !resolvedContactId && contactPhone) {
      const { phone, jid } = normalizePhoneAndJid(String(contactPhone));
      const contact = await prisma.contact.upsert({
        where: { jid },
        update: contactName ? { name: String(contactName).trim() } : {},
        create: { phone, jid, name: contactName ? String(contactName).trim() : null },
      });
      resolvedContactId = contact.id;
    }

    if (scope === 'TAG' && !tagId) {
      res.status(400).json({ error: 'Selecione um Grupo/Tag para esta regra.' });
      return;
    }

    if (scope === 'CONTACT' && !resolvedContactId) {
      res.status(400).json({
        error: 'Selecione um contato ou informe o número para uma regra Individual.',
      });
      return;
    }

    const rule = await prisma.aiRule.create({
      data: {
        name: String(name).trim(),
        scope: String(scope),
        isActive: Boolean(isActive),
        tagId: scope === 'TAG' ? String(tagId) : null,
        contactId: scope === 'CONTACT' ? resolvedContactId : null,
        objective: String(objective).trim(),
        toneOfVoice: String(toneOfVoice || '').trim(),
        knowledgeBase: String(knowledgeBase || '').trim(),
        stopCondition: String(stopCondition || '').trim(),
      },
      include: { tag: true, contact: true },
    });

    await logActivity(
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
    const { id } = req.params;
    const {
      name,
      scope,
      isActive,
      tagId,
      contactId,
      objective,
      toneOfVoice,
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
        ...(knowledgeBase !== undefined
          ? { knowledgeBase: String(knowledgeBase).trim() }
          : {}),
        ...(stopCondition !== undefined
          ? { stopCondition: String(stopCondition).trim() }
          : {}),
      },
      include: { tag: true, contact: true },
    });

    await logActivity('AI', `Regra de IA atualizada: "${updated.name}".`, 'INFO');
    res.json(updated);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar regra.',
    });
  }
});

rulesRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.aiRule.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir regra.',
    });
  }
});

rulesRouter.post('/tags', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const color = String(req.body?.color || '#10b981').trim();
    if (!name) {
      res.status(400).json({ error: 'Nome da tag é obrigatório.' });
      return;
    }
    const tag = await prisma.tag.create({
      data: { name, color },
      include: { _count: { select: { contacts: true } } },
    });
    res.status(201).json(tag);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao criar tag (verifique se já existe).',
    });
  }
});

rulesRouter.delete('/tags/:id', async (req, res) => {
  try {
    await prisma.tag.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir tag.',
    });
  }
});
