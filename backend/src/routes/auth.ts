import { Router } from 'express';
import { config } from '../config';
import { ensureUserDefaults, prisma } from '../db';
import {
  clearSessionCookie,
  extractTokenFromHeaders,
  hashPassword,
  resolveUserFromToken,
  setSessionCookie,
  signSessionToken,
  verifyGoogleIdToken,
  verifyPassword,
} from '../services/authService';
import { logActivity } from '../services/activityLog';
import { migrateLegacyDataForOwner } from '../services/legacyMigration';
import { whatsappManager } from '../services/whatsappService';

export const authRouter = Router();

authRouter.get('/config', (_req, res) => {
  res.json({
    googleClientId: config.googleClientId || null,
    googleEnabled: Boolean(config.googleClientId),
  });
});

authRouter.get('/me', async (req, res) => {
  try {
    const token = extractTokenFromHeaders(
      req.headers.cookie,
      req.headers.authorization
    );
    if (!token) {
      res.status(401).json({ user: null });
      return;
    }
    const user = await resolveUserFromToken(token);
    if (!user) {
      res.status(401).json({ user: null });
      return;
    }
    res.json({ user });
  } catch {
    res.status(401).json({ user: null });
  }
});

authRouter.post('/register', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || !email || !email.includes('@')) {
      res.status(400).json({ error: 'Informe nome e um e-mail válido.' });
      return;
    }
    if (password.length < 6) {
      res
        .status(400)
        .json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ error: 'Já existe uma conta cadastrada com este e-mail.' });
      return;
    }

    const userCount = await prisma.user.count();
    const isOwner =
      config.ownerEmail ? email === config.ownerEmail : userCount === 0;

    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        isOwner,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        isOwner: true,
      },
    });

    await ensureUserDefaults(user.id, isOwner);
    if (isOwner) {
      const mig = await migrateLegacyDataForOwner(user.id);
      if (mig.migratedSession) {
        void whatsappManager.getSession(user.id).connect();
      }
    }
    await logActivity(
      user.id,
      'SYSTEM',
      `Conta criada para ${user.email}. Ambiente isolado pronto!`,
      'SUCCESS'
    );

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);
    res.status(201).json({ user });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao criar conta.',
    });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      res.status(401).json({ error: 'E-mail ou senha incorretos.' });
      return;
    }

    await ensureUserDefaults(user.id, user.isOwner);
    if (user.isOwner) {
      const mig = await migrateLegacyDataForOwner(user.id);
      if (mig.migratedSession) {
        void whatsappManager.getSession(user.id).connect();
      }
    }
    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isOwner: user.isOwner,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Erro ao fazer login.',
    });
  }
});

authRouter.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
      res.status(400).json({ error: 'Credencial Google ausente.' });
      return;
    }

    const profile = await verifyGoogleIdToken(credential);

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleSub: profile.sub }, { email: profile.email }],
      },
    });

    if (!user) {
      const userCount = await prisma.user.count();
      const isOwner = config.ownerEmail
        ? profile.email === config.ownerEmail
        : userCount === 0;

      user = await prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
          googleSub: profile.sub,
          isOwner,
        },
      });
      await ensureUserDefaults(user.id, isOwner);
      if (isOwner) {
        const mig = await migrateLegacyDataForOwner(user.id);
        if (mig.migratedSession) {
          void whatsappManager.getSession(user.id).connect();
        }
      }
      await logActivity(
        user.id,
        'SYSTEM',
        `Conta Google conectada (${user.email}). Ambiente isolado criado!`,
        'SUCCESS'
      );
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          googleSub: profile.sub,
          name: user.name || profile.name,
          avatarUrl: profile.picture || user.avatarUrl,
        },
      });
      await ensureUserDefaults(user.id, user.isOwner);
      if (user.isOwner) {
        const mig = await migrateLegacyDataForOwner(user.id);
        if (mig.migratedSession) {
          void whatsappManager.getSession(user.id).connect();
        }
      }
    }

    const token = signSessionToken(user.id);
    setSessionCookie(res, token);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        isOwner: user.isOwner,
      },
    });
  } catch (err) {
    res.status(401).json({
      error:
        err instanceof Error ? err.message : 'Erro na autenticação com Google.',
    });
  }
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
