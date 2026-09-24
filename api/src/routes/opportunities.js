import { Router } from 'express';
import { z } from 'zod';

import { Opportunity } from '../models/index.js';
import { asyncRoute, httpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { ml } from '../services/mlClient.js';
import { buildProfilePayload } from '../services/profile.js';

const router = Router();

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  skills: z.string().optional(),
  location: z.string().trim().max(60).optional(),
  remote: z.enum(['true', 'false']).optional(),
  minStipend: z.coerce.number().int().min(0).optional(),
  type: z.enum(['internship', 'fresher']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

/**
 * Browsable listings for signed-out visitors. Cursor-paginated from the start:
 * retrofitting pagination into a demo the night before is a classic
 * self-inflicted wound.
 */
router.get(
  '/',
  validate(listQuery, 'query'),
  asyncRoute(async (req, res) => {
    const { q, location, remote, minStipend, type, limit, cursor } = req.query;
    const skills = (req.query.skills ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

    const filter = { isActive: true };
    if (q) filter.$text = { $search: q };
    if (type) filter.type = type;
    if (skills.length) filter.skillsRequired = { $in: skills };
    if (remote === 'true') filter['location.remote'] = true;
    if (location) {
      const pattern = new RegExp(escapeRegex(location), 'i');
      filter.$or = [{ 'location.city': pattern }, { 'location.state': pattern }];
    }
    if (minStipend) filter['stipend.max'] = { $gte: minStipend };

    // Keyset pagination on postedAt. Skip/limit degrades badly and, more to
    // the point, drops or repeats rows when new listings arrive mid-scroll.
    if (cursor) {
      const after = new Date(cursor);
      if (!Number.isNaN(after.valueOf())) filter.postedAt = { $lt: after };
    }

    const docs = await Opportunity.find(filter)
      .sort({ postedAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    const last = page.at(-1);

    res.json({
      items: page.map(toCard),
      nextCursor: hasMore && last?.postedAt ? new Date(last.postedAt).toISOString() : null,
    });
  }),
);

router.get(
  '/stats',
  asyncRoute(async (_req, res) => {
    const [total, remote, bySource, newest] = await Promise.all([
      Opportunity.countDocuments({ isActive: true }),
      Opportunity.countDocuments({ isActive: true, 'location.remote': true }),
      Opportunity.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Opportunity.findOne({ isActive: true }).sort({ postedAt: -1 }).select('postedAt').lean(),
    ]);

    res.json({
      total,
      remote,
      sources: bySource.map((row) => ({ source: row._id ?? 'unknown', count: row.count })),
      newestPostedAt: newest?.postedAt ?? null,
    });
  }),
);

/**
 * One listing, plus the full score breakdown when someone is signed in.
 * The breakdown is what the detail page exists to show -- the arithmetic
 * behind the number on the card.
 */
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const doc = await Opportunity.findById(req.params.id).lean().catch(() => null);
    if (!doc) throw httpError(404, 'That listing is no longer available.');

    const payload = { opportunity: { ...toCard(doc), description: doc.description ?? '' }, fit: null };

    if (req.user) {
      try {
        const profile = await buildProfilePayload(req.user);
        const response = await ml.score(profile, [req.params.id]);
        const item = response.items?.[0];
        if (item) {
          payload.fit = {
            score: item.score, band: item.band, reason: item.reason,
            components: item.components, matched: item.matched, missing: item.missing,
          };
        }
      } catch (err) {
        // The listing itself is still worth showing without a score.
        console.warn('[opportunities] scoring unavailable:', err.message);
        payload.fitError = 'Match score is unavailable right now.';
      }
    }

    res.json(payload);
  }),
);

function toCard(doc) {
  return {
    id: doc._id.toString(),
    title: doc.title,
    company: doc.company,
    companyLogo: doc.companyLogo ?? null,
    location: doc.location ?? {},
    type: doc.type,
    stipend: doc.stipend ?? null,
    durationMonths: doc.durationMonths ?? null,
    skillsRequired: doc.skillsRequired ?? [],
    skillsPreferred: doc.skillsPreferred ?? [],
    applyUrl: doc.applyUrl,
    postedAt: doc.postedAt ?? null,
    source: doc.source ?? null,
  };
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export default router;
