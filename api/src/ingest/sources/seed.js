import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const SEED_PATH = fileURLToPath(new URL('../../data/seed.csv', import.meta.url));

/**
 * Curated listings committed to the repo.
 *
 * This exists for one reason: on judging morning a source will rate-limit you,
 * change its schema, or simply be down, and you will not have time to care.
 * `docker compose up` on a laptop with no internet still gives you a full,
 * scoreable, demoable feed.
 *
 * Keep expanding it as you find good listings -- 300 rows is the target, and
 * every row you add is one less thing that can go wrong on stage.
 */
export async function loadSeed() {
  const csv = await readFile(SEED_PATH, 'utf8');
  const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true });
  const now = Date.now();

  return rows.map((row) => ({
    title: row.title,
    company: row.company,
    description: row.description?.replace(/\\n/g, '\n') ?? '',
    locationRaw: row.location ?? '',
    remote: String(row.remote).toLowerCase() === 'true',
    applyUrl: row.apply_url,
    // Relative ages so the freshness term stays meaningful however long the
    // repo sits unused. A fixed date would make every seeded row look stale.
    postedAt: new Date(now - Number(row.posted_days_ago ?? 7) * 86400000),
    stipend: row.stipend_min
      ? {
          min: Number(row.stipend_min),
          max: Number(row.stipend_max || row.stipend_min),
          currency: row.currency || 'INR',
          period: 'month',
        }
      : null,
    durationMonths: row.duration_months ? Number(row.duration_months) : null,
    requiredMonths: row.required_months ? Number(row.required_months) : null,
    // Deliberately not setting employmentType. Letting classify() read the
    // title is what keeps "Graduate Trainee" landing in `fresher` instead of
    // every seeded row collapsing into `internship`.
  }));
}
