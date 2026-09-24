import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';

export const COOKIE_NAME = 'ia_token';

export function issueCookie(res, userId) {
  const token = jwt.sign({ sub: userId }, env.jwtSecret, {
    expiresIn: `${env.jwtTtlDays}d`,
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    // Cross-site cookies need SameSite=None AND Secure. In development the
    // frontend is on localhost:5173 and the API on localhost:4000 -- same
    // site, different port -- so 'lax' works and does not need HTTPS.
    sameSite: env.isProd() ? 'none' : 'lax',
    secure: env.isProd(),
    maxAge: env.jwtTtlDays * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

export function clearCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readToken(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Attaches req.user when a valid token is present. Never rejects. */
export async function attachUser(req, _res, next) {
  const token = readToken(req);
  if (!token) return next();
  try {
    const { sub } = jwt.verify(token, env.jwtSecret);
    req.user = await User.findById(sub).select('+profile.embedding');
  } catch {
    // expired or forged -- treat as signed out rather than erroring
  }
  return next();
}

/** Rejects when there is no signed-in user. */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }
  return next();
}

export function requireAdminKey(req, res, next) {
  if (req.get('x-admin-key') !== env.adminKey) {
    return res.status(403).json({ error: 'Bad admin key.' });
  }
  return next();
}
