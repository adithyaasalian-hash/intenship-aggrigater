import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { Application, FeedCache, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, httpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { ml } from '../services/mlClient.js';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const supported = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!supported.includes(file.mimetype)) {
      return cb(new Error('Upload a PDF, JPG, PNG, or WEBP résumé.'));
    }
    return cb(null, true);
  },
});

router.get('/', requireAuth, (req, res) => res.json({ user: req.user.toPublic() }));

/* --------------------------------------------------------------- résumé
 * The magic moment: drop a PDF, watch your own skills appear.
 *
 * We store the extracted skills as editable pills rather than as ground
 * truth. Parsing is good, not perfect, and letting the student fix it in two
 * clicks is both a better product and the honest answer when a judge's own
 * résumé parses badly on stage.
 */
router.post(
  '/resume',
  requireAuth,
  upload.single('resume'),
  asyncRoute(async (req, res) => {
    if (!req.file) throw httpError(400, 'Attach a PDF or image résumé.');

    const parsed = await ml.parseResume(req.file.buffer, req.file.originalname, req.file.mimetype);

    const user = req.user;
    user.profile.skills = parsed.skills.map((name) => ({ name, source: 'resume' }));
    user.profile.education = parsed.education ?? [];
    user.profile.experienceMonths = parsed.experienceMonths ?? 0;
    user.profile.embedding = parsed.embedding;
    user.profile.resumeFilename = req.file.originalname;
    user.profile.resumeCharCount = parsed.charCount;
    user.profile.parsedAt = new Date();
    user.profile.version += 1;
    if (!user.name && parsed.name) user.name = parsed.name;

    await user.save();
    await FeedCache.deleteMany({ userId: user._id });

    res.json({
      user: user.toPublic(),
      parsed: {
        name: parsed.name,
        email: parsed.email,
        links: parsed.links,
        charCount: parsed.charCount,
        skillCount: parsed.skills.length,
        degraded: parsed.degraded,
      },
    });
  }),
);

/* ------------------------------------------------------------- profile */
const profilePatch = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    skills: z.array(z.string().trim().toLowerCase().min(1).max(60)).max(120).optional(),
    experienceMonths: z.number().int().min(0).max(600).optional(),
    preferences: z
      .object({
        locations: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
        remoteOk: z.boolean().optional(),
        minStipend: z.number().int().min(0).max(1_000_000).nullable().optional(),
        domains: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      })
      .optional(),
  })
  .strict();

router.patch(
  '/profile',
  requireAuth,
  validate(profilePatch),
  asyncRoute(async (req, res) => {
    const user = req.user;
    const { name, skills, experienceMonths, preferences } = req.body;

    if (name !== undefined) user.name = name;

    if (skills) {
      // Preserve where each skill came from, so the UI can still show which
      // ones the parser found. Anything new the user typed is theirs.
      const previous = new Map((user.profile.skills ?? []).map((s) => [s.name, s.source]));
      user.profile.skills = [...new Set(skills)].map((skillName) => ({
        name: skillName,
        source: previous.get(skillName) ?? 'user',
      }));
    }

    if (experienceMonths !== undefined) user.profile.experienceMonths = experienceMonths;

    if (preferences) {
      user.profile.preferences = { ...user.profile.preferences.toObject?.() ?? user.profile.preferences, ...preferences };
    }

    user.profile.version += 1;
    await user.save();
    await FeedCache.deleteMany({ userId: user._id });

    res.json({ user: user.toPublic() });
  }),
);

router.delete(
  '/resume',
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = req.user;
    user.profile.skills = (user.profile.skills ?? []).filter((s) => s.source === 'user');
    user.profile.embedding = undefined;
    user.profile.resumeFilename = undefined;
    user.profile.parsedAt = undefined;
    user.profile.version += 1;
    await user.save();
    await FeedCache.deleteMany({ userId: user._id });
    res.json({ user: user.toPublic() });
  }),
);

router.delete(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    await Promise.all([
      Application.deleteMany({ userId: req.user._id }),
      FeedCache.deleteMany({ userId: req.user._id }),
      User.deleteOne({ _id: req.user._id }),
    ]);
    res.json({ ok: true });
  }),
);

export default router;
