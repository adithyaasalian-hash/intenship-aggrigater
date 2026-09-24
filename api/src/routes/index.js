import { Router } from 'express';

import adminRoutes from './admin.js';
import applicationRoutes from './applications.js';
import authRoutes from './auth.js';
import feedRoutes from './feed.js';
import meRoutes from './me.js';
import opportunityRoutes from './opportunities.js';
import { Opportunity } from '../models/index.js';
import { asyncRoute } from '../middleware/error.js';
import { ml } from '../services/mlClient.js';

const router = Router();

router.get(
  '/health',
  asyncRoute(async (_req, res) => {
    // Reports its own health honestly even when the ML service is down, so
    // you can tell "API is broken" from "Python container is asleep".
    const [listings, mlHealth] = await Promise.all([
      Opportunity.estimatedDocumentCount().catch(() => null),
      ml.health().catch((err) => ({ ok: false, error: err.message })),
    ]);
    res.json({ ok: true, listings, ml: mlHealth, uptimeSeconds: Math.round(process.uptime()) });
  }),
);

router.use('/auth', authRoutes);
router.use('/me', meRoutes);
router.use('/opportunities', opportunityRoutes);
router.use('/feed', feedRoutes);
router.use('/applications', applicationRoutes);
router.use('/admin', adminRoutes);

export default router;
