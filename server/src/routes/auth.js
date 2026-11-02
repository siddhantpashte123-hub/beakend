// ─────────────────────────────────────────────────────────────
// BlueBeakend — auth endpoints (/api/v1/auth)
// ─────────────────────────────────────────────────────────────
import { z } from 'zod';
import { randomHex, sha256 } from '../utils/ids.js';
import { hashPassword, verifyPassword, generatePassword } from '../utils/passwords.js';
import { signAccessToken, newRefreshToken, hashRefreshToken } from '../utils/tokens.js';
import { parse, publicUser } from '../utils/validate.js';
import { badRequest, unauthorized, forbidden, conflict, notFound, notImplemented } from '../errors.js';
import { sendMail } from '../utils/mailer.js';
import { config } from '../config.js';
import { makeUserGuard } from '../middleware/adminAuth.js';
import { createLogger } from '../logger.js';

const log = createLogger('auth');

const credentialsSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(200),
  name: z.string().max(120).optional(),
  metadata: z.record(z.any()).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function authRoutes(app, ctx) {
  const { db } = ctx;
  const userGuard = makeUserGuard({ db });

  async function issueTokens(user, req) {
    const { token: refreshToken, tokenHash } = newRefreshToken();
    await db.createSession({
      tokenHash,
      userId: user.id,
      expiresAt: new Date(Date.now() + config.refreshTtl * 1000),
      userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      ip: req.ip,
    });
    const updated = await db.updateUser(user.id, { lastLoginAt: new Date().toISOString() });
    return {
      user: publicUser(updated || user),
      accessToken: signAccessToken(updated || user),
      refreshToken,
      expiresIn: config.accessTtl,
    };
  }

  // ── POST /register ────────────────────────────────────────
  app.post('/register', async (req, reply) => {
    const signupsEnabled = (await db.getSetting('enableSignups', config.enableSignups)) !== false;
    if (!signupsEnabled) throw forbidden('Signups are currently disabled');
    const body = parse(credentialsSchema, req.body ?? {});
    try {
      const user = await db.createUser({
        email: body.email,
        passwordHash: await hashPassword(body.password),
        name: body.name || '',
        metadata: body.metadata || {},
      });
      // Create an email verification token automatically so users can verify if needed
      const verifyRaw = randomHex(24);
      await db.createToken({
        tokenHash: sha256(verifyRaw),
        userId: user.id,
        type: 'verify',
        expiresAt: new Date(Date.now() + 86400_000),
      });
      const result = await issueTokens(user, req);
      await db.recordActivity({
        type: 'auth.register',
        actor: user.email,
        userId: user.id,
        message: `New user registered: ${user.email}`,
      });
      log.info(`user registered: ${user.email}`);
      return reply.code(201).send(result);
    } catch (err) {
      if (err.code === 'UNIQUE_VIOLATION') throw conflict('This email is already registered');
      throw err;
    }
  });

  // ── POST /login ───────────────────────────────────────────
  app.post('/login', async (req) => {
    const body = parse(loginSchema, req.body ?? {});
    const user = await db.findUserByEmail(body.email);
    if (!user) throw unauthorized('Invalid email or password');
    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password');
    if (user.status === 'banned') throw unauthorized('This account has been banned');
    const result = await issueTokens(user, req);
    await db.recordActivity({
      type: 'auth.login',
      actor: user.email,
      userId: user.id,
      message: `User signed in: ${user.email}`,
    });
    log.info(`user logged in: ${user.email}`);
    return result;
  });

  // ── POST /logout ──────────────────────────────────────────
  app.post('/logout', async (req) => {
    const { refreshToken } = req.body ?? {};
    if (refreshToken) {
      const session = await db.findSessionByTokenHash(hashRefreshToken(refreshToken));
      if (session) await db.revokeSession(session.id, session.userId);
    }
    return { ok: true };
  });

  // ── POST /refresh ─────────────────────────────────────────
  app.post('/refresh', async (req) => {
    const { refreshToken } = req.body ?? {};
    if (!refreshToken) throw badRequest('refreshToken is required');
    const session = await db.findSessionByTokenHash(hashRefreshToken(refreshToken));
    if (!session || session.revokedAt || new Date(session.expiresAt) < new Date()) {
      throw unauthorized('Refresh token is invalid or expired');
    }
    const user = await db.findUserById(session.userId);
    if (!user || user.status !== 'active') throw unauthorized('User not found or banned');
    await db.revokeSession(session.id, session.userId);
    return issueTokens(user, req);
  });

  // ── GET /me ───────────────────────────────────────────────
  app.get('/me', { preHandler: userGuard }, async (req) => ({ user: publicUser(req.user) }));

  // ── PATCH /me ─────────────────────────────────────────────
  app.patch('/me', { preHandler: userGuard }, async (req) => {
    const schema = z.object({
      name: z.string().max(120).optional(),
      password: z.string().min(6).max(200).optional(),
      metadata: z.record(z.any()).optional(),
    });
    const body = parse(schema, req.body ?? {});
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.metadata !== undefined) patch.metadata = body.metadata;
    if (body.password) {
      patch.passwordHash = await hashPassword(body.password);
      await db.revokeAllSessions(req.user.id);
    }
    const user = await db.updateUser(req.user.id, patch);
    await db.recordActivity({
      type: 'auth.profile_updated',
      actor: req.user.email,
      userId: req.user.id,
      message: `Profile updated for ${req.user.email}`,
    });
    return { user: publicUser(user) };
  });

  // ── POST /password/forgot ─────────────────────────────────
  app.post('/password/forgot', async (req) => {
    const { email } = req.body ?? {};
    if (!email || !EMAIL_RE.test(email)) throw badRequest('Valid email is required');
    const user = await db.findUserByEmail(email);
    if (user) {
      const raw = randomHex(24);
      await db.createToken({
        tokenHash: sha256(raw),
        userId: user.id,
        type: 'reset',
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const resetUrl = `${config.publicUrl()}/admin/login?resetToken=${raw}`;
      await sendMail({
        to: user.email,
        subject: 'Reset your BlueBeakend password',
        text: `Hi ${user.name || user.email},\n\nReset token: ${raw}\nReset link: ${resetUrl}\n\nThis link expires in 1 hour.`,
        html: `<p>Hi ${user.name || user.email},</p><p><a href="${resetUrl}">Reset your password</a> (token: <code>${raw}</code>) — expires in 1 hour.</p>`,
      });
      await db.recordActivity({
        type: 'auth.password_forgot',
        actor: user.email,
        userId: user.id,
        message: `Password reset requested for ${user.email}`,
      });
    }
    return { ok: true, message: 'If that email exists, a reset link has been sent.' };
  });

  // ── POST /password/reset ──────────────────────────────────
  app.post('/password/reset', async (req) => {
    const schema = z.object({
      token: z.string().min(10),
      newPassword: z.string().min(6).max(200),
    });
    const body = parse(schema, req.body ?? {});
    const record = await db.findToken(sha256(body.token), 'reset');
    if (!record) throw badRequest('Reset token is invalid or expired');
    await db.updateUser(record.userId, { passwordHash: await hashPassword(body.newPassword) });
    await db.consumeToken(sha256(body.token));
    await db.revokeAllSessions(record.userId);
    await db.recordActivity({
      type: 'auth.password_reset',
      actor: 'user',
      userId: record.userId,
      message: 'User completed password reset',
    });
    return { ok: true, message: 'Password updated. Please log in again.' };
  });

  // ── POST /verify-email ────────────────────────────────────
  app.post('/verify-email', async (req) => {
    const { token } = req.body ?? {};
    if (!token) throw badRequest('token is required');
    const record = await db.findToken(sha256(token), 'verify');
    if (!record) throw badRequest('Verify token is invalid or expired');
    await db.updateUser(record.userId, { emailVerified: true });
    await db.consumeToken(sha256(token));
    return { ok: true, message: 'Email verified.' };
  });

  // ── GET /sessions ─────────────────────────────────────────
  app.get('/sessions', { preHandler: userGuard }, async (req) => {
    const sessions = await db.listSessions(req.user.id);
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
    };
  });

  // ── DELETE /sessions/:id ──────────────────────────────────
  app.delete('/sessions/:id', { preHandler: userGuard }, async (req) => {
    const ok = await db.revokeSession(req.params.id, req.user.id);
    if (!ok) throw notFound('Session not found');
    return { ok: true };
  });

  // ── POST /oauth/google & /oauth/github ────────────────────
  async function handleOauth(provider, req) {
    const clientEnv = provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.GITHUB_CLIENT_ID;
    const { email, name, providerToken } = req.body ?? {};
    if (!clientEnv) {
      throw notImplemented(`${provider === 'google' ? 'Google' : 'GitHub'} OAuth is not configured. Set ${provider.toUpperCase()}_CLIENT_ID in .env.`);
    }
    if (!providerToken || !email || !EMAIL_RE.test(email)) {
      throw badRequest('providerToken and valid email are required');
    }
    let user = await db.findUserByEmail(email);
    if (!user) {
      user = await db.createUser({
        email,
        passwordHash: await hashPassword(generatePassword()),
        name: name || email.split('@')[0],
        provider,
        emailVerified: true,
      });
    }
    if (user.status === 'banned') throw unauthorized('This account has been banned');
    return issueTokens(user, req);
  }

  app.post('/oauth/google', async (req) => handleOauth('google', req));
  app.post('/oauth/github', async (req) => handleOauth('github', req));
}
