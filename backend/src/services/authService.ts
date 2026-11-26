import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../db';

export const SESSION_COOKIE_NAME = 'zapflow_session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isOwner: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

let cachedSecret: string | null = null;

function getSessionSecret(): string {
  if (cachedSecret) return cachedSecret;
  if (config.sessionSecret) {
    cachedSecret = config.sessionSecret;
    return cachedSecret;
  }
  // Persiste um segredo aleatório ao lado do diretório de sessão (Volume persistente no Railway)
  const secretDir = path.dirname(config.sessionDir);
  const secretFile = path.join(secretDir, '.session_secret');
  try {
    fs.mkdirSync(secretDir, { recursive: true });
    if (fs.existsSync(secretFile)) {
      const existing = fs.readFileSync(secretFile, 'utf-8').trim();
      if (existing.length >= 32) {
        cachedSecret = existing;
        return cachedSecret;
      }
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    cachedSecret = generated;
    return cachedSecret;
  } catch {
    cachedSecret = crypto.randomBytes(48).toString('hex');
    return cachedSecret;
  }
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
}

export function signSessionToken(userId: string): string {
  const payload = JSON.stringify({
    sub: userId,
    exp: Date.now() + TOKEN_TTL_MS,
  });
  const encodedPayload = base64UrlEncode(payload);
  const signature = base64UrlEncode(
    crypto
      .createHmac('sha256', getSessionSecret())
      .update(encodedPayload)
      .digest()
  );
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): { userId: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encodedPayload, signature] = parts;
    const expectedSig = base64UrlEncode(
      crypto
        .createHmac('sha256', getSessionSecret())
        .update(encodedPayload)
        .digest()
    );
    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSig);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      return null;
    }
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as {
      sub?: string;
      exp?: number;
    };
    if (!parsed.sub || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return { userId: parsed.sub };
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    if (key) result[key] = val;
  }
  return result;
}

export function extractTokenFromHeaders(
  cookieHeader?: string,
  authHeader?: string
): string | null {
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookieHeader(cookieHeader);
  return cookies[SESSION_COOKIE_NAME] || null;
}

export function setSessionCookie(res: Response, token: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: TOKEN_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
}

export async function resolveUserFromToken(token: string): Promise<AuthUser | null> {
  const verified = verifySessionToken(token);
  if (!verified) return null;
  const user = await prisma.user.findUnique({
    where: { id: verified.userId },
    select: {
      id: true,
      email: true,
      name: true,
      avatarUrl: true,
      isOwner: true,
    },
  });
  return user;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractTokenFromHeaders(
      req.headers.cookie,
      req.headers.authorization
    );
    if (!token) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }

    const user = await resolveUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: 'Sessão inválida ou expirada.' });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Falha ao validar autenticação.' });
  }
}

export interface GoogleTokenProfile {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
}

export async function verifyGoogleIdToken(
  idToken: string
): Promise<GoogleTokenProfile> {
  if (!config.googleClientId) {
    throw new Error(
      'Login com Google não configurado no servidor (defina GOOGLE_CLIENT_ID).'
    );
  }

  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
  );

  if (!res.ok) {
    throw new Error('Token do Google inválido ou expirado.');
  }

  const data = (await res.json()) as {
    aud?: string;
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
  };

  if (data.aud !== config.googleClientId) {
    throw new Error('Token do Google não pertence a esta aplicação.');
  }

  const verified =
    data.email_verified === true || data.email_verified === 'true';
  if (!verified || !data.email || !data.sub) {
    throw new Error('Conta Google sem e-mail verificado.');
  }

  return {
    sub: data.sub,
    email: data.email.toLowerCase(),
    name: data.name || data.email.split('@')[0],
    picture: data.picture || null,
  };
}
