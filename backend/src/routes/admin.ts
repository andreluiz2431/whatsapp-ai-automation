import { Router } from 'express';
import { ensureUserDefaults, prisma } from '../db';
import { logActivity } from '../services/activityLog';
import {
  formatAuthUser,
  getSystemConfig,
  hashPassword,
  serializePermissions,
  UserModulePermissions,
} from '../services/authService';
import { whatsappManager } from '../services/whatsappService';

export const adminRouter = Router();

const VALID_ROLES = new Set(['ADMIN', 'USER']);
const VALID_STATUSES = new Set(['ACTIVE', 'PENDING', 'SUSPENDED']);
const VALID_PLANS = new Set(['FREE', 'TRIAL', 'PRO', 'ENTERPRISE']);
const VALID_LICENSE_STATUSES = new Set(['ACTIVE', 'TRIAL', 'EXPIRED', 'SUSPENDED']);

adminRouter.get('/overview', async (_req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    const [
      users,
      systemConfig,
      messagesTodayByConv,
      messagesMonthCount,
      aiTodayAgg,
      aiMonthAgg,
      totalMessagesByConv,
    ] = await Promise.all([
      prisma.user.findMany({
        orderBy: [{ isOwner: 'desc' }, { createdAt: 'asc' }],
        include: {
          settings: {
            select: {
              aiProvider: true,
              geminiModel: true,
              geminiApiKey: true,
              dailyAiRequestLimit: true,
            },
          },
          _count: {
            select: {
              conversations: true,
              campaigns: true,
              trainingExamples: true,
            },
          },
        },
      }),
      getSystemConfig(),
      prisma.message.findMany({
        where: { createdAt: { gte: startOfDay } },
        select: { conversation: { select: { userId: true } } },
      }),
      prisma.message.count({
        where: { createdAt: { gte: startOfMonth } },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: startOfDay } },
        _count: { id: true },
        _sum: { totalTokens: true },
      }),
      prisma.aiUsageLog.groupBy({
        by: ['userId'],
        where: { createdAt: { gte: startOfMonth } },
        _count: { id: true },
        _sum: { totalTokens: true },
      }),
      prisma.message.groupBy({
        by: ['conversationId'],
        _count: { id: true },
      }),
    ]);

    // Mapeia conversationId -> userId para contagem total de mensagens por usuário
    const convOwners = await prisma.conversation.findMany({
      select: { id: true, userId: true },
    });
    const convOwnerMap = new Map<string, string>();
    for (const c of convOwners) convOwnerMap.set(c.id, c.userId);

    const msgTodayByUser = new Map<string, number>();
    for (const m of messagesTodayByConv) {
      const uid = m.conversation.userId;
      msgTodayByUser.set(uid, (msgTodayByUser.get(uid) || 0) + 1);
    }

    const msgTotalByUser = new Map<string, number>();
    for (const row of totalMessagesByConv) {
      const uid = convOwnerMap.get(row.conversationId);
      if (uid) {
        msgTotalByUser.set(uid, (msgTotalByUser.get(uid) || 0) + row._count.id);
      }
    }

    const aiTodayMap = new Map<string, { req: number; tokens: number }>();
    for (const row of aiTodayAgg) {
      aiTodayMap.set(row.userId, {
        req: row._count.id || 0,
        tokens: row._sum.totalTokens || 0,
      });
    }

    const aiMonthMap = new Map<string, { req: number; tokens: number }>();
    for (const row of aiMonthAgg) {
      aiMonthMap.set(row.userId, {
        req: row._count.id || 0,
        tokens: row._sum.totalTokens || 0,
      });
    }

    let activeUsers = 0;
    let pendingUsers = 0;
    let suspendedUsers = 0;
    let expiredLicenses = 0;
    let adminUsers = 0;
    let totalConversations = 0;
    let aiRequestsToday = 0;
    let aiTokensToday = 0;
    let aiRequestsMonth = 0;
    let aiTokensMonth = 0;

    const enrichedUsers = users.map((u) => {
      const formatted = formatAuthUser(u);
      const waQuick = whatsappManager.getSessionQuickStatus(u.id);
      const todayAi = aiTodayMap.get(u.id) || { req: 0, tokens: 0 };
      const monthAi = aiMonthMap.get(u.id) || { req: 0, tokens: 0 };

      if (formatted.status === 'ACTIVE') activeUsers++;
      else if (formatted.status === 'PENDING') pendingUsers++;
      else if (formatted.status === 'SUSPENDED') suspendedUsers++;

      if (formatted.role === 'ADMIN') adminUsers++;
      const isExp =
        formatted.role !== 'ADMIN' &&
        (formatted.licenseStatus === 'EXPIRED' ||
          (formatted.licenseExpiresAt &&
            new Date(formatted.licenseExpiresAt).getTime() < now.getTime()));
      if (isExp) expiredLicenses++;

      totalConversations += u._count.conversations;
      aiRequestsToday += todayAi.req;
      aiTokensToday += todayAi.tokens;
      aiRequestsMonth += monthAi.req;
      aiTokensMonth += monthAi.tokens;

      return {
        ...formatted,
        adminNotes: u.adminNotes,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        whatsappStatus: waQuick.status,
        connectedPhone: waQuick.connectedPhone,
        aiProvider: u.settings?.aiProvider || 'gemini',
        geminiModel: u.settings?.geminiModel || '',
        hasGeminiKey: Boolean(u.settings?.geminiApiKey),
        dailyAiRequestLimit: u.settings?.dailyAiRequestLimit || 250,
        stats: {
          conversationsCount: u._count.conversations,
          messagesToday: msgTodayByUser.get(u.id) || 0,
          messagesTotal: msgTotalByUser.get(u.id) || 0,
          aiRequestsToday: todayAi.req,
          aiTokensToday: todayAi.tokens,
          aiRequestsMonth: monthAi.req,
          aiTokensMonth: monthAi.tokens,
          campaignsCount: u._count.campaigns,
          trainingExamplesCount: u._count.trainingExamples,
        },
      };
    });

    res.json({
      summary: {
        totalUsers: users.length,
        activeUsers,
        pendingUsers,
        suspendedUsers,
        expiredLicenses,
        adminUsers,
        connectedWhatsApps: whatsappManager.getConnectedCount(),
        totalConversations,
        messagesToday: messagesTodayByConv.length,
        messagesMonth: messagesMonthCount,
        aiRequestsToday,
        aiTokensToday,
        aiRequestsMonth,
        aiTokensMonth,
      },
      systemConfig,
      users: enrichedUsers,
    });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao carregar visão administrativa.',
    });
  }
});

adminRouter.post('/users', async (req, res) => {
  try {
    const adminId = req.user!.id;
    const {
      name,
      email,
      password,
      role = 'USER',
      status = 'ACTIVE',
      plan = 'FREE',
      licenseStatus = 'ACTIVE',
      licenseExpiresAt = null,
      permissions,
      dailyAiRequestLimit,
      adminNotes = '',
    } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
      status?: string;
      plan?: string;
      licenseStatus?: string;
      licenseExpiresAt?: string | null;
      permissions?: Partial<UserModulePermissions>;
      dailyAiRequestLimit?: number;
      adminNotes?: string;
    };

    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');

    if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
      res.status(400).json({ error: 'Informe nome e e-mail válidos.' });
      return;
    }
    if (cleanPassword.length < 6) {
      res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }

    const exists = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (exists) {
      res.status(409).json({ error: 'Já existe um usuário com este e-mail.' });
      return;
    }

    const safeRole = VALID_ROLES.has(String(role).toUpperCase())
      ? String(role).toUpperCase()
      : 'USER';
    const safeStatus = VALID_STATUSES.has(String(status).toUpperCase())
      ? String(status).toUpperCase()
      : 'ACTIVE';
    const safePlan = VALID_PLANS.has(String(plan).toUpperCase())
      ? String(plan).toUpperCase()
      : 'FREE';
    const safeLicense = VALID_LICENSE_STATUSES.has(
      String(licenseStatus).toUpperCase()
    )
      ? String(licenseStatus).toUpperCase()
      : 'ACTIVE';
    const parsedExp = licenseExpiresAt ? new Date(licenseExpiresAt) : null;

    const created = await prisma.user.create({
      data: {
        name: cleanName,
        email: cleanEmail,
        passwordHash: hashPassword(cleanPassword),
        isOwner: false,
        role: safeRole,
        status: safeStatus,
        plan: safePlan,
        licenseStatus: safeLicense,
        licenseExpiresAt:
          parsedExp && !Number.isNaN(parsedExp.getTime()) ? parsedExp : null,
        permissionsJson: serializePermissions(permissions),
        adminNotes: String(adminNotes || '').trim() || null,
      },
    });

    await ensureUserDefaults(created.id, false);
    if (dailyAiRequestLimit !== undefined) {
      await prisma.userSettings.update({
        where: { userId: created.id },
        data: {
          dailyAiRequestLimit: Math.max(10, Number(dailyAiRequestLimit) || 250),
        },
      });
    }

    await logActivity(
      adminId,
      'SYSTEM',
      `Admin criou usuário ${cleanEmail} (Plano ${safePlan} • Papel ${safeRole}).`,
      'SUCCESS'
    );

    res.status(201).json({ user: formatAuthUser(created) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao criar usuário.',
    });
  }
});

adminRouter.patch('/users/:id', async (req, res) => {
  try {
    const adminId = req.user!.id;
    const { id } = req.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    const {
      name,
      role,
      status,
      plan,
      licenseStatus,
      licenseExpiresAt,
      permissions,
      dailyAiRequestLimit,
      adminNotes,
      newPassword,
    } = req.body as {
      name?: string;
      role?: string;
      status?: string;
      plan?: string;
      licenseStatus?: string;
      licenseExpiresAt?: string | null;
      permissions?: Partial<UserModulePermissions>;
      dailyAiRequestLimit?: number;
      adminNotes?: string | null;
      newPassword?: string;
    };

    if (target.isOwner) {
      if (role && String(role).toUpperCase() !== 'ADMIN') {
        res.status(400).json({
          error: 'Não é possível remover privilégios de Admin da conta proprietária (Owner).',
        });
        return;
      }
      if (status && String(status).toUpperCase() !== 'ACTIVE') {
        res.status(400).json({
          error: 'Não é possível suspender a conta proprietária (Owner).',
        });
        return;
      }
    }

    if (target.id === adminId && status && String(status).toUpperCase() !== 'ACTIVE') {
      res.status(400).json({ error: 'Você não pode suspender sua própria conta.' });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined && String(name).trim()) {
      data.name = String(name).trim();
    }
    if (role !== undefined && VALID_ROLES.has(String(role).toUpperCase())) {
      data.role = String(role).toUpperCase();
    }
    if (status !== undefined && VALID_STATUSES.has(String(status).toUpperCase())) {
      data.status = String(status).toUpperCase();
    }
    if (plan !== undefined && VALID_PLANS.has(String(plan).toUpperCase())) {
      data.plan = String(plan).toUpperCase();
    }
    if (
      licenseStatus !== undefined &&
      VALID_LICENSE_STATUSES.has(String(licenseStatus).toUpperCase())
    ) {
      data.licenseStatus = String(licenseStatus).toUpperCase();
    }
    if (licenseExpiresAt !== undefined) {
      if (!licenseExpiresAt) {
        data.licenseExpiresAt = null;
      } else {
        const d = new Date(licenseExpiresAt);
        data.licenseExpiresAt = Number.isNaN(d.getTime()) ? null : d;
      }
    }
    if (permissions !== undefined) {
      data.permissionsJson = serializePermissions(permissions);
    }
    if (adminNotes !== undefined) {
      data.adminNotes = String(adminNotes || '').trim() || null;
    }
    if (newPassword && String(newPassword).length >= 6) {
      data.passwordHash = hashPassword(String(newPassword));
    }

    const updated = await prisma.user.update({
      where: { id },
      data,
    });

    if (dailyAiRequestLimit !== undefined) {
      await ensureUserDefaults(id, updated.isOwner);
      await prisma.userSettings.update({
        where: { userId: id },
        data: {
          dailyAiRequestLimit: Math.max(10, Number(dailyAiRequestLimit) || 250),
        },
      });
    }

    // Se o usuário foi suspenso ou teve licença bloqueada, desconecta o WhatsApp imediatamente
    if (
      !updated.isOwner &&
      (updated.status === 'SUSPENDED' ||
        updated.licenseStatus === 'SUSPENDED' ||
        updated.licenseStatus === 'EXPIRED')
    ) {
      await whatsappManager.getSession(id).disconnect(false).catch(() => {});
    }

    await logActivity(
      adminId,
      'SYSTEM',
      `Admin atualizou usuário ${updated.email} (Status: ${updated.status} • Plano: ${updated.plan} • Licença: ${updated.licenseStatus}).`,
      'INFO'
    );

    res.json({ user: formatAuthUser(updated) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao atualizar usuário.',
    });
  }
});

adminRouter.delete('/users/:id', async (req, res) => {
  try {
    const adminId = req.user!.id;
    const { id } = req.params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }
    if (target.isOwner || target.id === adminId) {
      res.status(400).json({
        error: 'Não é permitido excluir a conta proprietária ou sua própria conta.',
      });
      return;
    }

    await whatsappManager.getSession(id).disconnect(true).catch(() => {});
    await prisma.user.delete({ where: { id } });

    await logActivity(
      adminId,
      'SYSTEM',
      `Admin excluiu a conta ${target.email}.`,
      'WARN'
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao excluir usuário.',
    });
  }
});

adminRouter.put('/system-config', async (req, res) => {
  try {
    const adminId = req.user!.id;
    const {
      requireAdminApproval,
      defaultNewUserPlan,
      defaultTrialDays,
      defaultPermissions,
    } = req.body as {
      requireAdminApproval?: boolean;
      defaultNewUserPlan?: string;
      defaultTrialDays?: number;
      defaultPermissions?: Partial<UserModulePermissions>;
    };

    const current = await getSystemConfig();
    const safePlan =
      defaultNewUserPlan &&
      VALID_PLANS.has(String(defaultNewUserPlan).toUpperCase())
        ? String(defaultNewUserPlan).toUpperCase()
        : current.defaultNewUserPlan;

    await prisma.systemConfig.upsert({
      where: { id: 'global' },
      update: {
        ...(requireAdminApproval !== undefined
          ? { requireAdminApproval: Boolean(requireAdminApproval) }
          : {}),
        defaultNewUserPlan: safePlan,
        ...(defaultTrialDays !== undefined
          ? { defaultTrialDays: Math.max(0, Number(defaultTrialDays) || 0) }
          : {}),
        ...(defaultPermissions !== undefined
          ? { defaultPermissionsJson: serializePermissions(defaultPermissions) }
          : {}),
      },
      create: {
        id: 'global',
        requireAdminApproval: Boolean(requireAdminApproval ?? false),
        defaultNewUserPlan: safePlan,
        defaultTrialDays: Math.max(0, Number(defaultTrialDays) || 0),
        defaultPermissionsJson: serializePermissions(defaultPermissions),
      },
    });

    const updated = await getSystemConfig();
    await logActivity(
      adminId,
      'SYSTEM',
      `Política global de novos usuários atualizada (Aprovação manual: ${
        updated.requireAdminApproval ? 'SIM' : 'NÃO'
      } • Plano padrão: ${updated.defaultNewUserPlan}).`,
      'INFO'
    );
    res.json({ systemConfig: updated });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Erro ao salvar política global do sistema.',
    });
  }
});
