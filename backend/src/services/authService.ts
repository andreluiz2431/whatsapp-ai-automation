import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { prisma } from '../db';

export const SESSION_COOKIE_NAME = 'zapflow_session';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias

export interface UserModulePermissions {
  conversations: boolean;
  rules: boolean;
  training: boolean;
  campaigns: boolean;
  vision: boolean;
  audio: boolean;
}

export type ModulePermissionKey = keyof UserModulePermissions;

export const DEFAULT_PERMISSIONS: UserModulePermissions = {
  conversations: true,
  rules: true,
  training: true,
  campaigns: true,
  vision: true,
  audio: true,
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isOwner: boolean;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED';
  plan: 'FREE' | 'TRIAL' | 'PRO' | 'ENTERPRISE';
  licenseStatus: 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'SUSPENDED';
  licenseExpiresAt: string | null;
  permissions: UserModulePermissions;
}

export function parsePermissions(raw?: string | null): UserModulePermissions {
  if (!raw) return { ...DEFAULT_PERMISSIONS };
  try {
    const parsed = JSON.parse(raw) as Partial<UserModulePermissions>;
    return {
      conversations:
        parsed.conversations !== undefined ? Boolean(parsed.conversations) : true,
      rules: parsed.rules !== undefined ? Boolean(parsed.rules) : true,
      training: parsed.training !== undefined ? Boolean(parsed.training) : true,
      campaigns: parsed.campaigns !== undefined ? Boolean(parsed.campaigns) : true,
      vision: parsed.vision !== undefined ? Boolean(parsed.vision) : true,
      audio: parsed.audio !== undefined ? Boolean(parsed.audio) : true,
    };
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

export function serializePermissions(
  partial?: Partial<UserModulePermissions> | null
): string {
  const normalized: UserModulePermissions = {
    conversations:
      partial?.conversations !== undefined ? Boolean(partial.conversations) : true,
    rules: partial?.rules !== undefined ? Boolean(partial.rules) : true,
    training: partial?.training !== undefined ? Boolean(partial.training) : true,
    campaigns: partial?.campaigns !== undefined ? Boolean(partial.campaigns) : true,
    vision: partial?.vision !== undefined ? Boolean(partial.vision) : true,
    audio: partial?.audio !== undefined ? Boolean(partial.audio) : true,
  };
  return JSON.stringify(normalized);
}

export function isUserAdmin(user: Pick<AuthUser, 'isOwner' | 'role'>): boolean {
  return Boolean(user.isOwner || user.role === 'ADMIN');
}

export function getUserAccessBlockReason(
  user: Pick<AuthUser, 'isOwner' | 'role' | 'status' | 'licenseStatus' | 'licenseExpiresAt'>
): string | null {
  if (isUserAdmin(user)) return null;
  if (user.status === 'SUSPENDED') {
    return 'Sua conta foi suspensa pelo administrador.';
  }
  if (user.status === 'PENDING') {
    return 'Sua conta foi criada e está aguardando aprovação do administrador.';
  }
  if (user.licenseStatus === 'SUSPENDED') {
    return 'Sua licença de uso está suspensa. Entre em contato com o administrador.';
  }
  if (user.licenseStatus === 'EXPIRED') {
    return 'Sua licença de uso expirou. Entre em contato com o administrador para renovar.';
  }
  if (
    user.licenseExpiresAt &&
    new Date(user.licenseExpiresAt).getTime() < Date.now()
  ) {
    return 'Sua licença de uso venceu. Entre em contato com o administrador para renovar.';
  }
  return null;
}

export function formatAuthUser(dbUser: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  isOwner: boolean;
  role: string;
  status: string;
  plan: string;
  licenseStatus: string;
  licenseExpiresAt: Date | null;
  permissionsJson: string;
}): AuthUser {
  const role: 'ADMIN' | 'USER' =
    dbUser.isOwner || dbUser.role === 'ADMIN' ? 'ADMIN' : 'USER';
  const permissions =
    role === 'ADMIN'
      ? { ...DEFAULT_PERMISSIONS }
      : parsePermissions(dbUser.permissionsJson);
  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    avatarUrl: dbUser.avatarUrl,
    isOwner: dbUser.isOwner,
    role,
    status: (dbUser.status || 'ACTIVE') as AuthUser['status'],
    plan: (dbUser.plan || 'FREE') as AuthUser['plan'],
    licenseStatus: (dbUser.licenseStatus || 'ACTIVE') as AuthUser['licenseStatus'],
    licenseExpiresAt: dbUser.licenseExpiresAt
      ? dbUser.licenseExpiresAt.toISOString()
      : null,
    permissions,
  };
}

export async function getSystemConfig() {
  let cfg = await prisma.systemConfig.findUnique({ where: { id: 'global' } });
  if (!cfg) {
    cfg = await prisma.systemConfig.create({
      data: {
        id: 'global',
        requireAdminApproval: false,
        defaultNewUserPlan: 'FREE',
        defaultTrialDays: 0,
      },
    });
  }
  return {
    requireAdminApproval: cfg.requireAdminApproval,
    defaultNewUserPlan: (cfg.defaultNewUserPlan || 'FREE') as AuthUser['plan'],
    defaultTrialDays: cfg.defaultTrialDays || 0,
    defaultPermissions: parsePermissions(cfg.defaultPermissionsJson),
  };
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
      role: true,
      status: true,
      plan: true,
      licenseStatus: true,
      licenseExpiresAt: true,
      permissionsJson: true,
    },
  });
  return user ? formatAuthUser(user) : null;
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

    const blockReason = getUserAccessBlockReason(user);
    if (blockReason) {
      res.status(403).json({ error: blockReason });
      return;
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Falha ao validar autenticação.' });
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.user || !isUserAdmin(req.user)) {
    res.status(403).json({
      error: 'Acesso restrito a administradores da plataforma.',
    });
    return;
  }
  next();
}

const MODULE_LABELS: Record<ModulePermissionKey, string> = {
  conversations: 'Conversas & Atendimento IA',
  rules: 'Fluxos & Personas IA',
  training: 'Treinamento IA',
  campaigns: 'Campanhas & Disparos',
  vision: 'Leitura de Imagens (Visão IA)',
  audio: 'Transcrição de Áudios (Áudio IA)',
};

export function requireModule(moduleKey: ModulePermissionKey) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Autenticação necessária.' });
      return;
    }
    if (isUserAdmin(req.user) || req.user.permissions[moduleKey]) {
      next();
      return;
    }
    res.status(403).json({
      error: `O módulo "${MODULE_LABELS[moduleKey]}" não está liberado para sua conta. Solicite ao administrador.`,
    });
  };
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
