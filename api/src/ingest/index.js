import { IngestRun, Opportunity } from '../models/index.js';
import { ml } from '../services/mlClient.js';
import { fingerprint } from './normalize.js';
import { SOURCES, toOpportunity } from './sources/index.js';

const EMBED_BATCH = 64;
const STALE_DAYS = 45;

/**
 * One ingestion pass.
 *
 * For each source: fetch, filter to internships, extract skills, embed, upsert.
 * Skills and embeddings are computed here rather than at request time -- that
 * is what lets the feed read straight from MongoDB and never wait on the
 * Python container to wake up.
 *
 * Every stage is defensive. A source that 500s, changes its schema, or returns
 * HTML instead of JSON must not take down the other five.
 */
export async function runIngest({ only } = {}) {
  const selected = SOURCES.filter(
    (source) => (only ? only.includes(source.name) : source.enabled()),
  );

  if (!selected.length) {
    console.warn('[ingest] no sources enabled - check your .env');
    return { runs: [], totalActive: await Opportunity.countDocuments({ isActive: true }) };
  }

  const runs = [];
  for (const source of selected) {
    runs.push(await ingestOne(source));
  }

  const deactivated = await deactivateStale();

  // Tell the ML service to rebuild its in-memory index now, rather than
  // leaving new listings unsearchable until its next 5-minute refresh.
  await ml.reindex().catch((err) => console.warn(`[ingest] reindex failed: ${err.message}`));

  const totalActive = await Opportunity.countDocuments({ isActive: true });
  console.log(`[ingest] done - ${totalActive} active listings, ${deactivated} retired`);
  return { runs, totalActive, deactivated };
}

async function ingestOne(source) {
  const run = {
    source: source.name,
    startedAt: new Date(),
    fetched: 0, inserted: 0, updated: 0, skipped: 0,
    errors: [],
  };

  try {
    const raw = await source.fetch();
    run.fetched = raw.length;

    // 1. map + filter to internships
    const mapped = [];
    for (const row of raw) {
      const doc = toOpportunity(row, source.name);
      if (doc) mapped.push(doc);
      else run.skipped += 1;
    }

    // 2. de-duplicate within this batch before touching Mongo, so one payload
    //    containing the same job twice does not race itself in the upsert
    const byFingerprint = new Map();
    for (const doc of mapped) {
      byFingerprint.set(fingerprint(doc), doc);
    }

    // 3. skills + embeddings, batched
    const entries = [...byFingerprint.entries()];
    await enrich(entries.map(([, doc]) => doc), run);

    // 4. write
    for (const [key, doc] of entries) {
      const result = await Opportunity.updateOne(
        { fingerprint: key },
        {
          $set: { ...doc, fingerprint: key, lastSeenAt: new Date(), isActive: true },
          $setOnInsert: { firstSeenAt: new Date() },
          $addToSet: { sources: source.name },
        },
        { upsert: true },
      );
      if (result.upsertedCount) run.inserted += 1;
      else if (result.modifiedCount) run.updated += 1;
    }
  } catch (err) {
    run.errors.push(err.message);
    console.warn(`[ingest:${source.name}] ${err.message}`);
  }

  run.finishedAt = new Date();
  await IngestRun.create(run).catch(() => {});
  console.log(
    `[ingest:${source.name}] fetched=${run.fetched} new=${run.inserted} ` +
    `updated=${run.updated} skipped=${run.skipped}` +
    (run.errors.length ? ` errors=${run.errors.length}` : ''),
  );
  return run;
}

/**
 * Attach skillsRequired / skillsPreferred / embedding.
 *
 * Runs the same extractor over job descriptions that runs over résumés -- that
 * is the whole reason the overlap arithmetic means anything. If the ML service
 * is unreachable we still store the listing, unenriched, and log it; a feed of
 * unscored jobs beats no feed, and `GET /api/admin/unembedded` will tell you
 * how many need a re-run.
 */
async function enrich(docs, run) {
  if (!docs.length) return;

  for (let start = 0; start < docs.length; start += EMBED_BATCH) {
    const batch = docs.slice(start, start + EMBED_BATCH);
    const texts = batch.map(
      (doc) => `${doc.title}\n${doc.company}\n${doc.location?.raw ?? ''}\n${doc.description ?? ''}`,
    );

    try {
      const [skills, embeddings] = await Promise.all([
        ml.extractSkills(texts),
        ml.embed(texts),
      ]);
      batch.forEach((doc, i) => {
        doc.skillsRequired = skills.results[i]?.required ?? [];
        doc.skillsPreferred = skills.results[i]?.preferred ?? [];
        doc.embedding = embeddings.vectors[i];
      });
    } catch (err) {
      run.errors.push(`enrich: ${err.message}`);
      console.warn(`[ingest] enrichment failed for ${batch.length} rows: ${err.message}`);
    }
  }
}

/**
 * Retire listings no source has mentioned for a while.
 *
 * Soft-delete rather than hard: a student's tracker may still point at one,
 * and a board that shows "this listing closed" is more useful than one that
 * 404s.
 */
async function deactivateStale() {
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400000);
  const result = await Opportunity.updateMany(
    { isActive: true, lastSeenAt: { $lt: cutoff } },
    { $set: { isActive: false } },
  );
  return result.modifiedCount ?? 0;
}
