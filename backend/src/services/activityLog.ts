import { Server } from 'socket.io';
import { prisma } from '../db';
import { LogCategory, LogLevel } from '../types';

let ioInstance: Server | null = null;

export function setSocketServer(io: Server): void {
  ioInstance = io;
}

export function getUserRoom(userId: string): string {
  return `user:${userId}`;
}

export function emitUserEvent(
  userId: string,
  event: string,
  payload: unknown
): void {
  if (ioInstance) {
    ioInstance.to(getUserRoom(userId)).emit(event, payload);
  }
}

export async function logActivity(
  userId: string,
  category: LogCategory,
  message: string,
  level: LogLevel = 'INFO',
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const entry = await prisma.activityLog.create({
      data: {
        userId,
        level,
        category,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });
    emitUserEvent(userId, 'activity:log', entry);
  } catch (err) {
    console.error('[ActivityLog] Falha ao gravar log:', err);
  }
}
