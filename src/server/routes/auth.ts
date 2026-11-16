import { randomBytes, randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { accounts, authStates, sessions } from '../db/schema.js';
import {
  browserOrigin,
  currentUser,
  hashToken,
  requireAuth,
  requireCsrf,
  secureCookieForOrigin,
  setAppSessionCookie,
} from '../http/security.js';

const router = Router();
const cookieOptions = (origin: string) => ({
  secure: secureCookieForOrigin(origin),
  sameSite: secureCookieForOrigin(origin) ? ('none' as const) : ('lax' as const),
  path: '/',
});
const fail = (res: import('express').Response, status = 400) =>
  res.status(status).send('تعذر إتمام تسجيل الدخول. يمكنك إغلاق هذه الصفحة والمحاولة مجددًا.');

router.post('/csrf', (_req, res) => {
  const origin = browserOrigin(_req.get('origin'));
  if (!origin) {
    res
      .status(403)
      .json({ error: { code: 'INVALID_ORIGIN', message: 'تعذر التحقق من مصدر الطلب.' } });
    return;
  }
  const token = randomBytes(32).toString('base64url');
  res.cookie('qadi_csrf', token, {
    ...cookieOptions(origin.origin),
    httpOnly: false,
    maxAge: 10 * 60 * 1000,
  });
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ csrfToken: token });
});

const authStart: RequestHandler[] = [
  requireCsrf,
  async (req, res) => {
    try {
      const originFromHeader = browserOrigin(req.get('origin'));
      const originFromBody = browserOrigin(req.body?.origin);
      const portalBase = process.env.MANUS_OAUTH_PORTAL_URL;
      const appId = process.env.MANUS_PROJECT_ID;
      const csrf = req.cookies?.qadi_csrf as string | undefined;
      if (
        !originFromHeader ||
        !originFromBody ||
        originFromHeader.origin !== originFromBody.origin ||
        !portalBase ||
        !appId ||
        !csrf
      ) {
        res
          .status(400)
          .json({ error: { code: 'AUTH_UNAVAILABLE', message: 'تعذر بدء تسجيل الدخول.' } });
        return;
      }

      const redirectUri = new URL('/api/auth/callback', originFromBody.origin).toString();
      const nonce = randomBytes(24).toString('base64url');
      const state = Buffer.from(JSON.stringify({ redirectUri, nonce }), 'utf8').toString('base64');
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      await db.insert(authStates).values({
        id: randomUUID(),
        stateHash: hashToken(state),
        nonceHash: hashToken(nonce),
        csrfHash: hashToken(csrf),
        redirectUri,
        expiresAt,
      });

      const secure = secureCookieForOrigin(originFromBody.origin);
      res.cookie('qadi_oauth_nonce', nonce, {
        httpOnly: true,
        secure,
        sameSite: secure ? 'none' : 'lax',
        path: '/api/auth/callback',
        maxAge: 5 * 60 * 1000,
      });
      res.clearCookie('qadi_logged_out', cookieOptions(originFromBody.origin));

      const authorizationUrl = new URL('/app-auth', portalBase);
      authorizationUrl.searchParams.set('appId', appId);
      authorizationUrl.searchParams.set('redirectUri', redirectUri);
      authorizationUrl.searchParams.set('state', state);
      authorizationUrl.searchParams.set('responseType', 'code');
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ authorizationUrl: authorizationUrl.toString() });
    } catch {
      res
        .status(503)
        .json({ error: { code: 'AUTH_UNAVAILABLE', message: 'تعذر بدء تسجيل الدخول.' } });
    }
  },
];
router.post('/start', ...authStart);

router.get('/callback', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!state || state.length > 4096 || !code || code.length > 4096) return fail(res);

    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8')) as unknown;
    if (!decoded || typeof decoded !== 'object') return fail(res);
    const { redirectUri, nonce } = decoded as { redirectUri?: unknown; nonce?: unknown };
    const origin = browserOrigin(
      typeof redirectUri === 'string' ? new URL(redirectUri).origin : null,
    );
    const expectedCallback = origin ? new URL('/api/auth/callback', origin.origin).toString() : '';
    if (
      !origin ||
      redirectUri !== expectedCallback ||
      typeof nonce !== 'string' ||
      nonce.length < 20
    )
      return fail(res);

    const [savedState] = await db
      .select()
      .from(authStates)
      .where(eq(authStates.stateHash, hashToken(state)))
      .limit(1);
    const nonceCookie = req.cookies?.qadi_oauth_nonce as string | undefined;
    const csrfCookie = req.cookies?.qadi_csrf as string | undefined;
    if (
      !savedState ||
      savedState.expiresAt.getTime() <= Date.now() ||
      savedState.redirectUri !== redirectUri ||
      savedState.nonceHash !== hashToken(nonce) ||
      nonceCookie !== nonce ||
      !csrfCookie ||
      savedState.csrfHash !== hashToken(csrfCookie)
    ) {
      return fail(res);
    }

    // Consume state before exchanging the authorization code to prevent replay.
    await db
      .delete(authStates)
      .where(and(eq(authStates.id, savedState.id), eq(authStates.stateHash, hashToken(state))));

    const apiBase = process.env.MANUS_OAUTH_API_URL;
    const appId = process.env.MANUS_PROJECT_ID;
    if (!apiBase || !appId) return fail(res, 503);

    const exchange = await fetch(
      new URL('/webdev.v1.WebDevAuthPublicService/ExchangeToken', apiBase),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' },
        body: JSON.stringify({
          clientId: appId,
          grantType: 'authorization_code',
          code,
          redirectUri,
        }),
      },
    );
    const tokenResult = (await exchange.json()) as {
      accessToken?: unknown;
      error?: { message?: string };
    };
    if (
      !exchange.ok ||
      tokenResult.error ||
      typeof tokenResult.accessToken !== 'string' ||
      !tokenResult.accessToken
    )
      return fail(res, 401);

    const identityResponse = await fetch(
      new URL('/webdev.v1.WebDevAuthPublicService/GetUserInfo', apiBase),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'connect-protocol-version': '1' },
        body: JSON.stringify({ accessToken: tokenResult.accessToken }),
      },
    );
    const identity = (await identityResponse.json()) as {
      openId?: unknown;
      name?: unknown;
      email?: unknown;
      error?: { message?: string };
    };
    if (
      !identityResponse.ok ||
      identity.error ||
      typeof identity.openId !== 'string' ||
      !identity.openId
    )
      return fail(res, 401);

    const openId = identity.openId;
    const name = typeof identity.name === 'string' && identity.name ? identity.name : openId;
    const email = typeof identity.email === 'string' ? identity.email : null;
    await db
      .insert(accounts)
      .values({ id: randomUUID(), openId, name, email })
      .onDuplicateKeyUpdate({ set: { name, email } });
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.openId, openId))
      .limit(1);
    if (!account) return fail(res, 503);

    const sessionToken = randomBytes(32).toString('base64url');
    await db.insert(sessions).values({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: hashToken(sessionToken),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    const secure = secureCookieForOrigin(origin.origin);
    setAppSessionCookie(res, sessionToken, secure);
    res.clearCookie('qadi_oauth_nonce', {
      httpOnly: true,
      secure,
      sameSite: secure ? 'none' : 'lax',
      path: '/api/auth/callback',
    });
    res.setHeader('Cache-Control', 'private, no-store');
    res.redirect(303, new URL('/', origin.origin).toString());
  } catch {
    fail(res, 400);
  }
});

router.post('/logout', requireCsrf, requireAuth, async (req, res) => {
  try {
    const token = req.cookies?.webdev_app_session as string | undefined;
    if (token) {
      await db
        .delete(sessions)
        .where(
          and(
            eq(sessions.tokenHash, hashToken(token)),
            eq(sessions.accountId, currentUser(req).id),
          ),
        );
    }
    const origin = browserOrigin(req.get('origin'));
    const secure = secureCookieForOrigin(origin?.origin);
    const options = { secure, sameSite: secure ? ('none' as const) : ('lax' as const), path: '/' };
    res.clearCookie('webdev_app_session', { ...options, httpOnly: true });
    // Preview may reinject its signed cookie; this explicit opt-out suppresses it in the app.
    res.cookie('qadi_logged_out', '1', { ...options, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: 'تعذر تسجيل الخروج.' } });
  }
});

export default router;
