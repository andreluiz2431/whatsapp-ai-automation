import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../db';
import { logActivity } from './activityLog';

type SqlRow = Record<string, unknown>;

function resolveLegacyDbPath(): string {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const rawPath = dbUrl.replace(/^file:/, '');
  const resolved = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(__dirname, '../../prisma', rawPath);
  return `${resolved}.legacy.bak`;
}

function readLegacyTable(dbPath: string, table: string): SqlRow[] {
  // 1. Tenta node:sqlite nativo (Node 22.13+ / Node 24+ / Node 26+)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('node:sqlite') as {
      DatabaseSync: new (
        filename: string,
        opts?: { open?: boolean; readOnly?: boolean }
      ) => {
        prepare: (sql: string) => { all: () => SqlRow[] };
        close: () => void;
      };
    };
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const exists = db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`
        )
        .all();
      if (exists.length === 0) return [];
      return db.prepare(`SELECT * FROM "${table}"`).all();
    } finally {
      db.close();
    }
  } catch {
    // 2. Fallback via CLI sqlite3 -json (instalado na imagem Docker)
    try {
      const out = execFileSync(
        'sqlite3',
        ['-json', dbPath, `SELECT * FROM "${table}";`],
        { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
      ).trim();
      if (!out) return [];
      return JSON.parse(out) as SqlRow[];
    } catch {
      return [];
    }
  }
}

function toDate(val: unknown): Date {
  if (!val) return new Date();
  if (typeof val === 'number') return new Date(val);
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function toOptionalDate(val: unknown): Date | null {
  if (!val) return null;
  if (typeof val === 'number') return new Date(val);
  const d = new Date(String(val));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toBool(val: unknown, fallback = false): boolean {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  return String(val) === '1' || String(val).toLowerCase() === 'true';
}

/**
 * Move arquivos de sessão legados do Baileys (armazenados na raiz de auth_session/)
 * para a subpasta isolada do usuário dono (auth_session/<ownerUserId>/).
 */
export function migrateLegacyWhatsAppSession(ownerUserId: string): boolean {
  try {
    const rootDir = config.sessionDir;
    const legacyCreds = path.join(rootDir, 'creds.json');
    if (!fs.existsSync(legacyCreds)) {
      return false;
    }

    const targetDir = path.join(rootDir, ownerUserId);
    fs.mkdirSync(targetDir, { recursive: true });

    // Se o usuário já criou uma nova sessão na pasta dele, não sobrescreve
    if (fs.existsSync(path.join(targetDir, 'creds.json'))) {
      return false;
    }

    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    let movedCount = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      const src = path.join(rootDir, entry.name);
      const dst = path.join(targetDir, entry.name);
      fs.renameSync(src, dst);
      movedCount += 1;
    }

    console.log(
      `[LegacyMigration] Sessão WhatsApp antiga movida (${movedCount} arquivos) para usuário ${ownerUserId}.`
    );
    return movedCount > 0;
  } catch (err) {
    console.error('[LegacyMigration] Falha ao mover sessão WhatsApp legada:', err);
    return false;
  }
}

/**
 * Migra todos os registros do banco single-tenant legado (dev.db.legacy.bak)
 * para a conta do usuário dono (alm28062001@gmail.com).
 */
export async function migrateLegacyDataForOwner(
  ownerUserId: string
): Promise<{ migratedDb: boolean; migratedSession: boolean }> {
  const migratedSession = migrateLegacyWhatsAppSession(ownerUserId);

  const legacyDbPath = resolveLegacyDbPath();
  if (!fs.existsSync(legacyDbPath)) {
    return { migratedDb: false, migratedSession };
  }

  console.log(
    `[LegacyMigration] Iniciando importação de ${legacyDbPath} para o usuário ${ownerUserId}...`
  );

  try {
    // 1. AppSettings -> UserSettings
    const legacySettings = readLegacyTable(legacyDbPath, 'AppSettings');
    if (legacySettings.length > 0) {
      const s = legacySettings[0];
      const existing = await prisma.userSettings.findUnique({
        where: { userId: ownerUserId },
      });
      const legacyKey = String(s.geminiApiKey || '').trim();
      const rawModel = String(s.geminiModel || '').trim();
      const effectiveModel =
        !rawModel || rawModel === 'gemini-2.5-flash'
          ? config.geminiModel
          : rawModel;

      await prisma.userSettings.upsert({
        where: { userId: ownerUserId },
        update: {
          aiProvider: String(s.aiProvider || existing?.aiProvider || 'gemini'),
          geminiApiKey:
            legacyKey || existing?.geminiApiKey || config.geminiApiKey,
          geminiModel: effectiveModel,
          ollamaBaseUrl: String(
            s.ollamaBaseUrl || existing?.ollamaBaseUrl || config.ollamaBaseUrl
          ),
          ollamaModel: String(
            s.ollamaModel || existing?.ollamaModel || config.ollamaModel
          ),
          globalAutomationPaused: toBool(s.globalAutomationPaused, false),
          autoPauseOnManualSend: toBool(s.autoPauseOnManualSend, true),
          autoSummarizeConversations: toBool(s.autoSummarizeConversations, false),
          defaultMinDelaySec: Number(s.defaultMinDelaySec) || 45,
          defaultMaxDelaySec: Number(s.defaultMaxDelaySec) || 120,
          defaultBatchSize: Number(s.defaultBatchSize) || 20,
          defaultBatchPauseMin: Number(s.defaultBatchPauseMin) || 5,
          lastDailySummary: s.lastDailySummary
            ? String(s.lastDailySummary)
            : existing?.lastDailySummary || null,
          lastDailySummaryAt:
            toOptionalDate(s.lastDailySummaryAt) ||
            existing?.lastDailySummaryAt ||
            null,
        },
        create: {
          userId: ownerUserId,
          aiProvider: String(s.aiProvider || 'gemini'),
          geminiApiKey: legacyKey || config.geminiApiKey,
          geminiModel: effectiveModel,
          ollamaBaseUrl: String(s.ollamaBaseUrl || config.ollamaBaseUrl),
          ollamaModel: String(s.ollamaModel || config.ollamaModel),
          globalAutomationPaused: toBool(s.globalAutomationPaused, false),
          autoPauseOnManualSend: toBool(s.autoPauseOnManualSend, true),
          autoSummarizeConversations: toBool(s.autoSummarizeConversations, false),
          defaultMinDelaySec: Number(s.defaultMinDelaySec) || 45,
          defaultMaxDelaySec: Number(s.defaultMaxDelaySec) || 120,
          defaultBatchSize: Number(s.defaultBatchSize) || 20,
          defaultBatchPauseMin: Number(s.defaultBatchPauseMin) || 5,
          lastDailySummary: s.lastDailySummary ? String(s.lastDailySummary) : null,
          lastDailySummaryAt: toOptionalDate(s.lastDailySummaryAt),
        },
      });
    }

    // 2. Tags
    const tagIdMap = new Map<string, string>();
    const legacyTags = readLegacyTable(legacyDbPath, 'Tag');
    for (const row of legacyTags) {
      const oldId = String(row.id);
      const name = String(row.name || '').trim();
      if (!name) continue;
      const tag = await prisma.tag.upsert({
        where: { userId_name: { userId: ownerUserId, name } },
        update: { color: String(row.color || '#10b981') },
        create: {
          userId: ownerUserId,
          name,
          color: String(row.color || '#10b981'),
          createdAt: toDate(row.createdAt),
        },
      });
      tagIdMap.set(oldId, tag.id);
    }

    // 3. Contacts
    const contactIdMap = new Map<string, string>();
    const legacyContacts = readLegacyTable(legacyDbPath, 'Contact');
    for (const row of legacyContacts) {
      const oldId = String(row.id);
      const phone = String(row.phone || '').trim();
      const jid = String(row.jid || '').trim();
      if (!phone || !jid) continue;
      const contact = await prisma.contact.upsert({
        where: { userId_jid: { userId: ownerUserId, jid } },
        update: {
          name: row.name ? String(row.name) : undefined,
          notes: row.notes ? String(row.notes) : undefined,
        },
        create: {
          userId: ownerUserId,
          phone,
          jid,
          name: row.name ? String(row.name) : null,
          notes: row.notes ? String(row.notes) : null,
          createdAt: toDate(row.createdAt),
        },
      });
      contactIdMap.set(oldId, contact.id);
    }

    // 4. ContactTags
    const legacyContactTags = readLegacyTable(legacyDbPath, 'ContactTag');
    for (const row of legacyContactTags) {
      const contactId = contactIdMap.get(String(row.contactId));
      const tagId = tagIdMap.get(String(row.tagId));
      if (!contactId || !tagId) continue;
      await prisma.contactTag.upsert({
        where: { contactId_tagId: { contactId, tagId } },
        update: {},
        create: { contactId, tagId },
      });
    }

    // 5. AiRules
    const ruleIdMap = new Map<string, string>();
    const legacyRules = readLegacyTable(legacyDbPath, 'AiRule');
    if (legacyRules.length > 0) {
      // Remove a regra global genérica recém-criada se o backup já traz regras próprias
      const hasLegacyGlobal = legacyRules.some(
        (r) => String(r.scope) === 'GLOBAL'
      );
      if (hasLegacyGlobal) {
        await prisma.aiRule.deleteMany({
          where: {
            userId: ownerUserId,
            scope: 'GLOBAL',
            name: 'Atendimento Padrão (Global)',
          },
        });
      }

      for (const row of legacyRules) {
        const oldId = String(row.id);
        const rule = await prisma.aiRule.create({
          data: {
            userId: ownerUserId,
            name: String(row.name || 'Regra Migrada'),
            scope: String(row.scope || 'GLOBAL'),
            isActive: toBool(row.isActive, true),
            tagId: row.tagId ? tagIdMap.get(String(row.tagId)) || null : null,
            contactId: row.contactId
              ? contactIdMap.get(String(row.contactId)) || null
              : null,
            objective: String(row.objective || ''),
            toneOfVoice: String(row.toneOfVoice || ''),
            knowledgeBase: String(row.knowledgeBase || ''),
            stopCondition: String(row.stopCondition || ''),
            createdAt: toDate(row.createdAt),
          },
        });
        ruleIdMap.set(oldId, rule.id);
      }
    }

    // 6. Conversations
    const convIdMap = new Map<string, string>();
    const legacyConvs = readLegacyTable(legacyDbPath, 'Conversation');
    for (const row of legacyConvs) {
      const oldId = String(row.id);
      const contactId = contactIdMap.get(String(row.contactId));
      if (!contactId) continue;
      const conv = await prisma.conversation.upsert({
        where: { contactId },
        update: {
          mode: String(row.mode || 'AUTO'),
          activeRuleId: row.activeRuleId
            ? ruleIdMap.get(String(row.activeRuleId)) || null
            : null,
          lastMessageAt: toDate(row.lastMessageAt),
          lastMessagePreview: row.lastMessagePreview
            ? String(row.lastMessagePreview)
            : null,
          unreadCount: Number(row.unreadCount) || 0,
          aiSummary: row.aiSummary ? String(row.aiSummary) : null,
          aiSummaryUpdatedAt: toOptionalDate(row.aiSummaryUpdatedAt),
        },
        create: {
          userId: ownerUserId,
          contactId,
          mode: String(row.mode || 'AUTO'),
          activeRuleId: row.activeRuleId
            ? ruleIdMap.get(String(row.activeRuleId)) || null
            : null,
          lastMessageAt: toDate(row.lastMessageAt),
          lastMessagePreview: row.lastMessagePreview
            ? String(row.lastMessagePreview)
            : null,
          unreadCount: Number(row.unreadCount) || 0,
          aiSummary: row.aiSummary ? String(row.aiSummary) : null,
          aiSummaryUpdatedAt: toOptionalDate(row.aiSummaryUpdatedAt),
          createdAt: toDate(row.createdAt),
        },
      });
      convIdMap.set(oldId, conv.id);
    }

    // 7. Messages
    const legacyMsgs = readLegacyTable(legacyDbPath, 'Message');
    for (const row of legacyMsgs) {
      const conversationId = convIdMap.get(String(row.conversationId));
      if (!conversationId) continue;
      const waMessageId = row.waMessageId ? String(row.waMessageId) : null;
      if (waMessageId) {
        const exists = await prisma.message.findUnique({
          where: {
            conversationId_waMessageId: { conversationId, waMessageId },
          },
        });
        if (exists) continue;
      }
      await prisma.message.create({
        data: {
          conversationId,
          waMessageId,
          direction: String(row.direction || 'INBOUND'),
          senderType: String(row.senderType || 'CONTACT'),
          body: String(row.body || ''),
          status: String(row.status || 'SENT'),
          createdAt: toDate(row.createdAt),
        },
      });
    }

    // 8. Campaigns & CampaignItems
    const campIdMap = new Map<string, string>();
    const legacyCampaigns = readLegacyTable(legacyDbPath, 'Campaign');
    for (const row of legacyCampaigns) {
      const oldId = String(row.id);
      const rawStatus = String(row.status || 'DRAFT');
      const campaign = await prisma.campaign.create({
        data: {
          userId: ownerUserId,
          name: String(row.name || 'Campanha Migrada'),
          messageTemplate: String(row.messageTemplate || ''),
          useAiVariation: toBool(row.useAiVariation, false),
          autoEnableAiOnReply: toBool(row.autoEnableAiOnReply, true),
          aiRuleId: row.aiRuleId
            ? ruleIdMap.get(String(row.aiRuleId)) || null
            : null,
          minDelaySec: Number(row.minDelaySec) || 45,
          maxDelaySec: Number(row.maxDelaySec) || 120,
          batchSize: Number(row.batchSize) || 20,
          batchPauseMin: Number(row.batchPauseMin) || 5,
          status: rawStatus === 'RUNNING' ? 'PAUSED' : rawStatus,
          totalCount: Number(row.totalCount) || 0,
          sentCount: Number(row.sentCount) || 0,
          failedCount: Number(row.failedCount) || 0,
          startedAt: toOptionalDate(row.startedAt),
          completedAt: toOptionalDate(row.completedAt),
          createdAt: toDate(row.createdAt),
        },
      });
      campIdMap.set(oldId, campaign.id);
    }

    const legacyItems = readLegacyTable(legacyDbPath, 'CampaignItem');
    for (const row of legacyItems) {
      const campaignId = campIdMap.get(String(row.campaignId));
      if (!campaignId) continue;
      const rawStatus = String(row.status || 'PENDING');
      await prisma.campaignItem.create({
        data: {
          campaignId,
          contactId: row.contactId
            ? contactIdMap.get(String(row.contactId)) || null
            : null,
          name: String(row.name || 'Contato'),
          phone: String(row.phone || ''),
          resolvedMessage: row.resolvedMessage
            ? String(row.resolvedMessage)
            : null,
          status: rawStatus === 'SENDING' ? 'PENDING' : rawStatus,
          errorMessage: row.errorMessage ? String(row.errorMessage) : null,
          sentAt: toOptionalDate(row.sentAt),
          createdAt: toDate(row.createdAt),
        },
      });
    }

    // 9. ActivityLogs (últimos 100)
    const legacyLogs = readLegacyTable(legacyDbPath, 'ActivityLog').slice(-100);
    for (const row of legacyLogs) {
      await prisma.activityLog.create({
        data: {
          userId: ownerUserId,
          level: String(row.level || 'INFO'),
          category: String(row.category || 'SYSTEM'),
          message: String(row.message || ''),
          metadata: row.metadata ? String(row.metadata) : null,
          createdAt: toDate(row.createdAt),
        },
      });
    }

    // Marca backup como migrado para não duplicar em futuros reinícios
    const migratedPath = legacyDbPath.replace(/\.legacy\.bak$/, '.legacy.migrated');
    fs.renameSync(legacyDbPath, migratedPath);

    await logActivity(
      ownerUserId,
      'SYSTEM',
      `Migração concluída: ${legacyContacts.length} contato(s), ${legacyConvs.length} conversa(s), ${legacyMsgs.length} mensagem(ns), ${legacyRules.length} regra(s) e ${legacyCampaigns.length} campanha(s) importados do backup anterior.`,
      'SUCCESS'
    );

    console.log(
      `[LegacyMigration] Concluída para ${ownerUserId}: ${legacyContacts.length} contatos, ${legacyConvs.length} conversas, ${legacyMsgs.length} msgs, ${legacyRules.length} regras, ${legacyCampaigns.length} campanhas.`
    );
    return { migratedDb: true, migratedSession };
  } catch (err) {
    console.error('[LegacyMigration] Erro durante migração:', err);
    return { migratedDb: false, migratedSession };
  }
}
