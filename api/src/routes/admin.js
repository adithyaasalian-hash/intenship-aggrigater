import { Router } from 'express';

import { IngestRun, Opportunity } from '../models/index.js';
import { requireAdminKey } from '../middleware/auth.js';
import { asyncRoute } from '../middleware/error.js';
import { runIngest } from '../ingest/index.js';
import { ml } from '../services/mlClient.js';

const router = Router();

/**
 * Trigger ingestion by hand. Invaluable while building -- you do not want to
 * wait for a six-hour cron to find out your adapter has an off-by-one, and on
 * a free tier the container may be asleep when the cron would have fired.
 *
 *   curl -XPOST localhost:4000/api/admin/ingest -H 'x-admin-key: dev-admin-key'
 */
router.post(
  '/ingest',
  requireAdminKey,
  asyncRoute(async (req, res) => {
    const only = (req.query.only ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const summary = await runIngest({ only: only.length ? only : undefined });
    res.json(summary);
  }),
);

router.get(
  '/ingest/runs',
  requireAdminKey,
  asyncRoute(async (_req, res) => {
    const runs = await IngestRun.find().sort({ startedAt: -1 }).limit(30).lean();
    res.json({ runs });
  }),
);

/** Listings we have never managed to embed -- usually a sign the ML service
 *  was down during an ingestion run. Re-run ingest to fix. */
router.get(
  '/unembedded',
  requireAdminKey,
  asyncRoute(async (_req, res) => {
    const count = await Opportunity.countDocuments({
      isActive: true,
      $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
    });
    res.json({ unembedded: count });
  }),
);

router.get(
  '/ml',
  requireAdminKey,
  asyncRoute(async (_req, res) => res.json(await ml.health())),
);

export default router;
