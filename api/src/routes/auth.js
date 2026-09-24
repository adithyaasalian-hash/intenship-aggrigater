import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { User } from '../models/index.js';
import { clearCookie, issueCookie, requireAuth } from '../middleware/auth.js';
import { asyncRoute, httpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Two fields. No email confirmation, no captcha. Every extra step here is a
// step you have to perform on stage while a judge watches -- and a step that
// can fail on venue wifi.
const credentials = z.object({
  email: z.string().email('That does not look like an email address.'),
  password: z.string().min(8, 'Use at least 8 characters.'),
  name: z.string().trim().min(1).max(80).optional(),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

router.post(
  '/register',
  authLimiter,
  validate(credentials),
  asyncRoute(async (req, res) => {
    const { email, password, name } = req.body;

    if (await User.exists({ email })) {
      throw httpError(409, 'An account with that email already exists. Try signing in.');
    }

    const user = await User.create({
      email,
      name,
      passwordHash: await bcrypt.hash(password, 10),
    });

    issueCookie(res, user._id.toString());
    res.status(201).json({ user: user.toPublic() });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate(credentials.omit({ name: true })),
  asyncRoute(async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+passwordHash');

    // Same message and roughly the same work either way, so the response does
    // not reveal whether the account exists.
    const ok = user && (await bcrypt.compare(password, user.passwordHash));
    if (!ok) throw httpError(401, 'Wrong email or password.');

    issueCookie(res, user._id.toString());
    res.json({ user: user.toPublic() });
  }),
);

router.post('/logout', (_req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

router.get('/session', requireAuth, (req, res) => {
  res.json({ user: req.user.toPublic() });
});

export default router;
