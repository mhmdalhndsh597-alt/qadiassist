import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import { jwtVerify } from 'jose';
import { db } from '../db/index.js';
import { accounts, sessions } from '../db/schema.js';

export type AuthUser = {
  id: string;
  openId: string;
  name: string;
  email: string | null;
};

type AuthenticatedRequest = Request & { authUser?: AuthUser };

export const hashToken = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export function browserOrigin(input: unknown): URL | null {
  if (typeof input !== 'string' || input.length > 2048) return null;
  try {
    const url = new URL(input);
    const localHttp = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (!['https:', ...(localHttp ? ['http:'] : [])].includes(url.protocol)) return null;
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin === input ? url : null;
  } catch {
    return null;
  }
}

export const secureCookieForOrigin = (origin: string | null | undefined): boolean =>
  browserOrigin(origin)?.protocol === 'https:';

function equalTokens(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

async function accountForPreviewJwt(token: string): Promise<AuthUser | null> {
  const secret = process.env.MANUS_JWT_SECRET;
  const projectId = process.env.MANUS_PROJECT_ID;
  if (!secret || !projectId) return null;

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
    });
    if (payload.appId !== projectId || typeof payload.openId !== 'string' || !payload.openId) {
      return null;
    }

    const account = {
      id: crypto.randomUUID(),
      openId: payload.openId,
      name: typeof payload.name === 'string' && payload.name ? payload.name : payload.openId,
      email: typeof payload.email === 'string' ? payload.email : null,
    };
    await db
      .insert(accounts)
      .values(account)
      .onDuplicateKeyUpdate({
        set: { name: account.name, email: account.email },
      });
    const [saved] = await db
      .select({
        id: accounts.id,
        openId: accounts.openId,
        name: accounts.name,
        email: accounts.email,
      })
      .from(accounts)
      .where(eq(accounts.openId, account.openId))
      .limit(1);
    return saved ?? null;
  } catch {
    return null;
  }
}

export async function resolveUser(req: Request): Promise<AuthUser | null> {
  if (req.cookies?.qadi_logged_out === '1') return null;
  const token = req.cookies?.webdev_app_session;
  if (!token || typeof token !== 'string') return null;

  const [session] = await db
    .select({
      id: accounts.id,
      openId: accounts.openId,
      name: accounts.name,
      email: accounts.email,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(accounts, eq(sessions.accountId, accounts.id))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  if (session) {
    if (session.expiresAt.getTime() <= Date.now()) return null;
    const { expiresAt: _expiresAt, ...user } = session;
    return user;
  }

  // Preview injects a signed platform JWT in this exact cookie name.
  return accountForPreviewJwt(token);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  void resolveUser(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'يلزم تسجيل الدخول.' } });
        return;
      }
      (req as AuthenticatedRequest).authUser = user;
      next();
    })
    .catch(() => {
      res
        .status(503)
        .json({ error: { code: 'AUTH_UNAVAILABLE', message: 'تعذر التحقق من الجلسة.' } });
    });
};

export function currentUser(req: Request): AuthUser {
  const user = (req as AuthenticatedRequest).authUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  return user;
}

export const requireCsrf: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  const origin = browserOrigin(req.get('origin'));
  const cookieToken = req.cookies?.qadi_csrf as string | undefined;
  const headerToken = req.get('x-csrf-token');
  if (!origin || !equalTokens(cookieToken, headerToken)) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: 'تعذر التحقق من الطلب.' } });
    return;
  }
  next();
};

export function setAppSessionCookie(res: Response, token: string, secure: boolean): void {
  res.cookie('webdev_app_session', token, {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
