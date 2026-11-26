import cors from 'cors';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { config } from './config';
import { ensureServerRecovery, prisma } from './db';
import { authRouter } from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { conversationsRouter } from './routes/conversations';
import { dashboardRouter } from './routes/dashboard';
import { rulesRouter } from './routes/rules';
import { settingsRouter } from './routes/settings';
import { whatsappRouter } from './routes/whatsapp';
import { getUserRoom, setSocketServer } from './services/activityLog';
import {
  extractTokenFromHeaders,
  requireAuth,
  resolveUserFromToken,
} from './services/authService';
import { campaignQueueManager } from './services/campaignQueue';
import { migrateLegacyDataForOwner } from './services/legacyMigration';
import { whatsappManager } from './services/whatsappService';

async function bootstrap(): Promise<void> {
  await ensureServerRecovery();

  // Se o usuário dono (ex: alm28062001@gmail.com) já existir, migra imediatamente o backup legado
  const owner = await prisma.user.findFirst({
    where: config.ownerEmail
      ? { email: config.ownerEmail }
      : { isOwner: true },
    select: { id: true },
  });
  if (owner) {
    await migrateLegacyDataForOwner(owner.id);
  }

  const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.RAILWAY_PUBLIC_DOMAIN
      ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
      : []),
  ].filter(Boolean);

  const app = express();
  app.set('trust proxy', 1);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, true);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '5mb' }));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  });

  // Autenticação obrigatória no WebSocket — isola cada usuário em sua própria sala privada
  io.use(async (socket, next) => {
    try {
      const token = extractTokenFromHeaders(
        socket.handshake.headers.cookie,
        socket.handshake.headers.authorization
      );
      if (!token) {
        next(new Error('UNAUTHORIZED'));
        return;
      }
      const user = await resolveUserFromToken(token);
      if (!user) {
        next(new Error('UNAUTHORIZED'));
        return;
      }
      socket.data.userId = user.id;
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  setSocketServer(io);

  io.on('connection', async (socket) => {
    const userId = socket.data.userId as string;
    await socket.join(getUserRoom(userId));

    const state = await whatsappManager.getSession(userId).getState();
    socket.emit('whatsapp:status', state);
    if (state.qrDataUrl) {
      socket.emit('whatsapp:qr', { qrDataUrl: state.qrDataUrl });
    }
    socket.emit(
      'campaign:runtime',
      campaignQueueManager.getRunner(userId).getRuntimeState()
    );
  });

  // Endpoints públicos mínimos
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });
  app.use('/api/auth', authRouter);

  // Todas as demais rotas exigem usuário autenticado e isolam dados por userId
  app.use('/api/whatsapp', requireAuth, whatsappRouter);
  app.use('/api/dashboard', requireAuth, dashboardRouter);
  app.use('/api/conversations', requireAuth, conversationsRouter);
  app.use('/api/rules', requireAuth, rulesRouter);
  app.use('/api/campaigns', requireAuth, campaignsRouter);
  app.use('/api/settings', requireAuth, settingsRouter);

  // Serve o frontend compilado em produção (Railway single-service deploy)
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  server.listen(config.port, '0.0.0.0', async () => {
    console.log(
      `\n🚀 Backend ZapFlow AI (Multi-Tenant) rodando em http://0.0.0.0:${config.port}\n`
    );
    await whatsappManager.autoConnectExistingSessions();
  });
}

bootstrap().catch((err) => {
  console.error('Falha crítica ao iniciar servidor:', err);
  process.exit(1);
});
