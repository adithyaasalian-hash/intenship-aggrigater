import { Router } from 'express';
import { z } from 'zod';

import { FeedCache, Opportunity } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { ml } from '../services/mlClient.js';
import { buildProfilePayload, filterKeyOf } from '../services/profile.js';

const router = Router();

const csv = (value) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const feedQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().min(0).default(0),
  remote: z.enum(['true', 'false']).optional(),
  locations: z.string().optional(),
  skills: z.string().optional(),
  minStipend: z.coerce.number().int().min(0).optional(),
  refresh: z.enum(['true', 'false']).optional(),
});

/**
 * GET /api/feed  -- the demo endpoint.
 *
 * Ranked, scored, and explained. The response is shaped so the frontend can
 * render it directly: no raw vectors, no model names, no floats it has to
 * reformat. Agreeing this shape on day one is what lets frontend, backend and
 * ML work in parallel all week.
 *
 * Scores are computed once per (user, profile version, filter set) and cached
 * for an hour. The feed therefore reads from MongoDB and never blocks on the
 * Python service -- which matters because a sleeping free-tier container takes
 * 30-50 seconds to wake, and that is not a thing you want happening on stage.
 */
router.get(
  '/',
  requireAuth,
  validate(feedQuery, 'query'),
  asyncRoute(async (req, res) => {
    const { limit, cursor, refresh } = req.query;
    const filters = {
      remoteOnly: req.query.remote === 'true',
      locations: csv(req.query.locations),
      skills: csv(req.query.skills),
      minStipend: req.query.minStipend ?? null,
    };

    const profile = await buildProfilePayload(req.user);
    const profileVersion = req.user.profile?.version ?? 0;
    const filterKey = filterKeyOf(filters);

    let scored = null;
    let cached = true;
    let degraded = false;

    if (refresh !== 'true') {
      const hit = await FeedCache.findOne({
        userId: req.user._id, profileVersion, filterKey,
      }).lean();
      scored = hit?.items ?? null;
    }

    if (!scored) {
      cached = false;
      try {
        const response = await ml.recommend({
          profile,
          limit: 120, // cache a deep list; paginate from it without re-scoring
          remoteOnly: filters.remoteOnly,
          locations: filters.locations,
          minStipend: filters.minStipend ?? undefined,
          skills: filters.skills,
        });
        scored = response.items;
        degraded = response.degraded;

        await FeedCache.updateOne(
          { userId: req.user._id, profileVersion, filterKey },
          { $set: { items: scored, createdAt: new Date() } },
          { upsert: true },
        );
      } catch (err) {
        // The matching service is unreachable. Degrade to newest-first rather
        // than showing an error page -- a feed with no scores is still a feed,
        // and the banner tells the user (and you) exactly what is wrong.
        console.warn('[feed] falling back to newest-first:', err.message);
        const recent = await Opportunity.find({ isActive: true })
          .sort({ postedAt: -1 })
          .limit(limit)
          .lean();
        return res.json({
          items: recent.map((doc) => ({ opportunity: toCard(doc), fit: null })),
          nextCursor: null,
          meta: { cached: false, degraded: true, reason: err.message, total: recent.length },
        });
      }
    }

    const page = scored.slice(cursor, cursor + limit);
    const ids = page.map((item) => item.opportunityId);
    const docs = await Opportunity.find({ _id: { $in: ids } }).lean();
    const byId = new Map(docs.map((doc) => [doc._id.toString(), doc]));

    const items = page
      .filter((item) => byId.has(item.opportunityId))
      .map((item) => ({
        opportunity: toCard(byId.get(item.opportunityId)),
        fit: toFit(item),
      }));

    const nextCursor = cursor + limit < scored.length ? cursor + limit : null;

    res.json({
      items,
      nextCursor,
      meta: { cached, degraded, total: scored.length, profileVersion },
    });
  }),
);

/**
 * GET /api/feed/insights  -- the "so what" screen.
 *
 * Not "you scored 62", but "learning Docker unlocks 23 more strong matches".
 * This is the screen that turns an aggregator into career guidance, and it is
 * the line judges remember.
 */
router.get(
  '/insights',
  requireAuth,
  asyncRoute(async (req, res) => {
    const profile = await buildProfilePayload(req.user);

    if (!profile.skills.length) {
      return res.json({
        gaps: [], consideredRoles: 0,
        message: 'Add your skills or upload a résumé to see what to learn next.',
      });
    }

    const response = await ml.skillGap({
      profile,
      remoteOnly: false,
      locations: profile.preferences.locations,
      limit: 12,
    });
    return res.json(response);
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

function toFit(item) {
  return {
    score: item.score,
    band: item.band,
    reason: item.reason,
    components: item.components,
    matched: item.matched,
    missing: item.missing,
  };
}

export default router;
