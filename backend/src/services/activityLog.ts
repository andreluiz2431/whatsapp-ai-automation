import { Server } from 'socket.io';
import { prisma } from '../db';
import { LogCategory, LogLevel } from '../types';

let ioInstance: Server | null = null;

export function setSocketServer(io: Server): void {
  ioInstance = io;
}

export function emitSocketEvent(event: string, payload: unknown): void {
  if (ioInstance) {
    ioInstance.emit(event, payload);
  }
}

export async function logActivity(
  category: LogCategory,
  message: string,
  level: LogLevel = 'INFO',
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const entry = await prisma.activityLog.create({
      data: {
        level,
        category,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
    emitSocketEvent('activity:log', entry);
  } catch (err) {
    console.error('[ActivityLog] Falha ao gravar log:', err);
  }
}
