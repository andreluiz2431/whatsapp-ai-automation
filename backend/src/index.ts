import cors from 'cors';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { Server } from 'socket.io';
import { config } from './config';
import { ensureDefaults } from './db';
import { campaignsRouter } from './routes/campaigns';
import { conversationsRouter } from './routes/conversations';
import { dashboardRouter } from './routes/dashboard';
import { rulesRouter } from './routes/rules';
import { settingsRouter } from './routes/settings';
import { whatsappRouter } from './routes/whatsapp';
import { logActivity, setSocketServer } from './services/activityLog';
import { campaignQueue } from './services/campaignQueue';
import { whatsappService } from './services/whatsappService';

async function bootstrap(): Promise<void> {
  await ensureDefaults();

  const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...(process.env.RAILWAY_PUBLIC_DOMAIN
      ? [`https://${process.env.RAILWAY_PUBLIC_DOMAIN}`]
      : []),
  ].filter(Boolean);

  const app = express();
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
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    },
  });

  setSocketServer(io);

  io.on('connection', async (socket) => {
    const state = await whatsappService.getState();
    socket.emit('whatsapp:status', state);
    if (state.qrDataUrl) {
      socket.emit('whatsapp:qr', { qrDataUrl: state.qrDataUrl });
    }
    socket.emit('campaign:runtime', campaignQueue.getRuntimeState());
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.use('/api/whatsapp', whatsappRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/settings', settingsRouter);

  // Serve o frontend compilado em produção (ex: Railway single-service deploy)
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  server.listen(config.port, '0.0.0.0', async () => {
    console.log(
      `\n🚀 Backend ZapFlow AI rodando em http://0.0.0.0:${config.port}\n`
    );
    await logActivity(
      'SYSTEM',
      `Servidor iniciado na porta ${config.port}.`,
      'SUCCESS'
    );
    await whatsappService.autoConnectIfSessionExists();
  });
}

bootstrap().catch((err) => {
  console.error('Falha crítica ao iniciar servidor:', err);
  process.exit(1);
});
