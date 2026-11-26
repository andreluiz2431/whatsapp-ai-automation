import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { campaignQueue } from '../services/campaignQueue';
import { normalizePhoneAndJid } from '../services/whatsappService';

export const campaignsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

interface ParsedRecipient {
  name: string;
  phone: string;
}

function parseRawContactsText(raw: string): ParsedRecipient[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const recipients: ParsedRecipient[] = [];

  for (const line of lines) {
    const parts = line.split(/[,;\t]/).map((p) => p.replace(/^["']|["']$/g, '').trim());
    if (parts.length === 0) continue;

    let name = '';
    let rawPhone = '';

    if (parts.length === 1) {
      rawPhone = parts[0];
      name = 'Contato';
    } else {
      // Detecta qual coluna contém o número de telefone
      const digits0 = parts[0].replace(/\D/g, '');
      const digits1 = parts[1].replace(/\D/g, '');
      if (digits1.length >= 8) {
        name = parts[0] || 'Contato';
        rawPhone = parts[1];
      } else if (digits0.length >= 8) {
        rawPhone = parts[0];
        name = parts[1] || 'Contato';
      } else {
        // Provável linha de cabeçalho ("Nome, Telefone")
        continue;
      }
    }

    const digits = rawPhone.replace(/\D/g, '');
    if (digits.length < 8) continue;

    const { phone } = normalizePhoneAndJid(digits);
    if (seen.has(phone)) continue;
    seen.add(phone);

    recipients.push({
      name: name || 'Contato',
      phone,
    });
  }

  return recipients;
}

campaignsRouter.get('/', async (_req, res) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        aiRule: { select: { id: true, name: true, scope: true } },
        _count: { select: { items: true } },
      },
    });

    res.json({
      campaigns,
      runtime: campaignQueue.getRuntimeState(),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao listar campanhas.',
    });
  }
});

campaignsRouter.get('/:id', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
      include: {
        aiRule: true,
        items: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: 'Campanha não encontrada.' });
      return;
    }
    res.json(campaign);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao obter campanha.',
    });
  }
});

campaignsRouter.post('/parse-contacts', upload.single('file'), (req, res) => {
  try {
    let rawText = String(req.body?.text || '');
    if (req.file) {
      rawText = req.file.buffer.toString('utf-8');
    }
    const recipients = parseRawContactsText(rawText);
    res.json({ count: recipients.length, recipients });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao processar lista de contatos.',
    });
  }
});

campaignsRouter.post('/', async (req, res) => {
  try {
    const {
      name,
      messageTemplate,
      useAiVariation = false,
      autoEnableAiOnReply = true,
      aiRuleId = null,
      minDelaySec = 45,
      maxDelaySec = 120,
      batchSize = 20,
      batchPauseMin = 5,
      recipients = [],
      startImmediately = false,
    } = req.body as {
      name?: string;
      messageTemplate?: string;
      useAiVariation?: boolean;
      autoEnableAiOnReply?: boolean;
      aiRuleId?: string | null;
      minDelaySec?: number;
      maxDelaySec?: number;
      batchSize?: number;
      batchPauseMin?: number;
      recipients?: ParsedRecipient[];
      startImmediately?: boolean;
    };

    if (!name?.trim() || !messageTemplate?.trim()) {
      res.status(400).json({
        error: 'Nome da campanha e mensagem inicial são obrigatórios.',
      });
      return;
    }

    const cleanRecipients: ParsedRecipient[] = [];
    const seen = new Set<string>();
    for (const r of recipients) {
      const digits = String(r.phone || '').replace(/\D/g, '');
      if (digits.length < 8) continue;
      const { phone } = normalizePhoneAndJid(digits);
      if (seen.has(phone)) continue;
      seen.add(phone);
      cleanRecipients.push({
        name: String(r.name || 'Contato').trim() || 'Contato',
        phone,
      });
    }

    if (cleanRecipients.length === 0) {
      res.status(400).json({
        error: 'Adicione ao menos 1 contato válido para criar a campanha.',
      });
      return;
    }

    const safeMin = Math.max(5, Number(minDelaySec) || 45);
    const safeMax = Math.max(safeMin, Number(maxDelaySec) || 120);

    const campaign = await prisma.campaign.create({
      data: {
        name: name.trim(),
        messageTemplate: messageTemplate.trim(),
        useAiVariation: Boolean(useAiVariation),
        autoEnableAiOnReply: Boolean(autoEnableAiOnReply),
        aiRuleId: aiRuleId || null,
        minDelaySec: safeMin,
        maxDelaySec: safeMax,
        batchSize: Math.max(1, Number(batchSize) || 20),
        batchPauseMin: Math.max(1, Number(batchPauseMin) || 5),
        totalCount: cleanRecipients.length,
        status: 'DRAFT',
        items: {
          create: cleanRecipients.map((r) => ({
            name: r.name,
            phone: r.phone,
            status: 'PENDING',
          })),
        },
      },
      include: {
        aiRule: { select: { id: true, name: true, scope: true } },
      },
    });

    if (startImmediately) {
      await campaignQueue.startCampaign(campaign.id);
    }

    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao criar campanha.',
    });
  }
});

campaignsRouter.post('/:id/start', async (req, res) => {
  try {
    await campaignQueue.startCampaign(req.params.id);
    res.json({ ok: true, runtime: campaignQueue.getRuntimeState() });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Erro ao iniciar campanha.',
    });
  }
});

campaignsRouter.post('/:id/pause', async (req, res) => {
  try {
    await campaignQueue.pauseCampaign(req.params.id);
    res.json({ ok: true, runtime: campaignQueue.getRuntimeState() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao pausar campanha.',
    });
  }
});

campaignsRouter.post('/:id/cancel', async (req, res) => {
  try {
    await campaignQueue.cancelCampaign(req.params.id);
    res.json({ ok: true, runtime: campaignQueue.getRuntimeState() });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao cancelar campanha.',
    });
  }
});

campaignsRouter.delete('/:id', async (req, res) => {
  try {
    const campaign = await prisma.campaign.findUnique({
      where: { id: req.params.id },
    });
    if (campaign?.status === 'RUNNING') {
      res.status(400).json({
        error: 'Pause ou cancele a campanha antes de excluí-la.',
      });
      return;
    }
    await prisma.campaign.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir campanha.',
    });
  }
});
