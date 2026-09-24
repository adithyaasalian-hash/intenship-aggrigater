import { Router } from 'express';
import { z } from 'zod';

import { Application, Opportunity } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncRoute, httpError } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

const router = Router();

const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected'];

const createBody = z.object({
  opportunityId: z.string().length(24, 'Not a valid listing id.'),
  status: z.enum(STATUSES).default('saved'),
  scoreAtSave: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const patchBody = z.object({
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(2000).optional(),
}).refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update.' });

/** The tracker board, grouped the way the UI renders it. */
router.get(
  '/',
  requireAuth,
  asyncRoute(async (req, res) => {
    const rows = await Application.find({ userId: req.user._id })
      .sort({ updatedAt: -1 })
      .populate('opportunityId')
      .lean();

    const columns = Object.fromEntries(STATUSES.map((s) => [s, []]));
    for (const row of rows) {
      if (!row.opportunityId) continue; // listing was purged
      columns[row.status].push({
        id: row._id.toString(),
        status: row.status,
        scoreAtSave: row.scoreAtSave ?? null,
        notes: row.notes ?? '',
        appliedAt: row.appliedAt ?? null,
        updatedAt: row.updatedAt,
        opportunity: {
          id: row.opportunityId._id.toString(),
          title: row.opportunityId.title,
          company: row.opportunityId.company,
          location: row.opportunityId.location ?? {},
          applyUrl: row.opportunityId.applyUrl,
          stipend: row.opportunityId.stipend ?? null,
        },
      });
    }

    res.json({ columns, total: rows.length });
  }),
);

router.post(
  '/',
  requireAuth,
  validate(createBody),
  asyncRoute(async (req, res) => {
    const { opportunityId, status, scoreAtSave, notes } = req.body;

    if (!(await Opportunity.exists({ _id: opportunityId }))) {
      throw httpError(404, 'That listing no longer exists.');
    }

    // Upsert rather than insert: clicking save twice should not 409 at the
    // user, and the unique index would otherwise make it do exactly that.
    const application = await Application.findOneAndUpdate(
      { userId: req.user._id, opportunityId },
      {
        $set: { status, ...(notes !== undefined && { notes }) },
        $setOnInsert: { scoreAtSave: scoreAtSave ?? null },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.status(201).json({ application: { id: application._id.toString(), status: application.status } });
  }),
);

router.patch(
  '/:id',
  requireAuth,
  validate(patchBody),
  asyncRoute(async (req, res) => {
    const update = { ...req.body };
    if (update.status === 'applied') update.appliedAt = new Date();

    const application = await Application.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: update },
      { new: true },
    );
    if (!application) throw httpError(404, 'Not on your board.');

    res.json({ application: { id: application._id.toString(), status: application.status } });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  asyncRoute(async (req, res) => {
    const result = await Application.deleteOne({ _id: req.params.id, userId: req.user._id });
    if (!result.deletedCount) throw httpError(404, 'Not on your board.');
    res.json({ ok: true });
  }),
);

export default router;
