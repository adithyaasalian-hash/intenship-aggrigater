import { env } from '../../config/env.js';
import { classify, parseDate, parseLocation, parseStipend, stripHtml, truncate } from '../normalize.js';
import { loadSeed } from './seed.js';

/**
 * Source adapters.
 *
 * Each one is a pure function: fetch, map to our shape, return an array. No
 * database access, no side effects. Adding a source is one entry in this file.
 *
 * Order matters only in that keyless sources come first -- you can be pulling
 * real listings thirty minutes into day two with no signup and nothing to
 * explain to a judge.
 */

const UA = 'internship-aggregator/1.0 (student hackathon project)';

async function getJson(url, { timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': UA, ...headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- RemoteOK */
const remoteok = {
  name: 'remoteok',
  enabled: () => true,
  async fetch() {
    const rows = await getJson('https://remoteok.com/api');
    // The first element is a legal notice, not a job. Skipping index 0 is the
    // single most common bug in every RemoteOK integration ever written.
    return rows.slice(1).map((row) => ({
      title: row.position ?? row.title,
      company: row.company,
      companyLogo: row.company_logo ?? row.logo ?? null,
      description: stripHtml(row.description ?? ''),
      locationRaw: row.location ?? 'Remote',
      remote: true,
      applyUrl: row.apply_url ?? row.url,
      postedAt: parseDate(row.date ?? row.epoch),
      stipendRaw: row.salary_min ? `${row.salary_min} - ${row.salary_max} USD per year` : null,
      employmentType: (row.tags ?? []).join(' '),
    }));
  },
};

/* -------------------------------------------------------------- Remotive */
const remotive = {
  name: 'remotive',
  enabled: () => true,
  async fetch() {
    const data = await getJson('https://remotive.com/api/remote-jobs?limit=300');
    return (data.jobs ?? []).map((job) => ({
      title: job.title,
      company: job.company_name,
      companyLogo: job.company_logo ?? null,
      description: stripHtml(job.description ?? ''),
      locationRaw: job.candidate_required_location ?? 'Remote',
      remote: true,
      applyUrl: job.url,
      postedAt: parseDate(job.publication_date),
      stipendRaw: job.salary || null,
      employmentType: job.job_type ?? '',
    }));
  },
};

/* ------------------------------------------------------------- Arbeitnow */
const arbeitnow = {
  name: 'arbeitnow',
  enabled: () => true,
  async fetch() {
    const data = await getJson('https://www.arbeitnow.com/api/job-board-api');
    return (data.data ?? []).map((job) => ({
      title: job.title,
      company: job.company_name,
      description: stripHtml(job.description ?? ''),
      locationRaw: job.location ?? '',
      remote: Boolean(job.remote),
      applyUrl: job.url,
      postedAt: parseDate(job.created_at),
      employmentType: (job.job_types ?? []).join(' '),
    }));
  },
};

/* ---------------------------------------------------------------- Adzuna */
const adzuna = {
  name: 'adzuna',
  // The only source here that needs a key. Free tier is roughly 1,000 calls a
  // month, which is plenty at one call every six hours.
  enabled: () => Boolean(env.adzunaAppId && env.adzunaAppKey),
  async fetch() {
    const results = [];
    for (const term of ['internship', 'intern', 'graduate trainee']) {
      const url = new URL(
        `https://api.adzuna.com/v1/api/jobs/${env.adzunaCountry}/search/1`,
      );
      url.searchParams.set('app_id', env.adzunaAppId);
      url.searchParams.set('app_key', env.adzunaAppKey);
      url.searchParams.set('results_per_page', '50');
      url.searchParams.set('what', term);
      url.searchParams.set('content-type', 'application/json');

      const data = await getJson(url.toString());
      for (const job of data.results ?? []) {
        results.push({
          title: job.title,
          company: job.company?.display_name ?? 'Unknown',
          description: stripHtml(job.description ?? ''),
          locationRaw: job.location?.display_name ?? '',
          remote: false,
          applyUrl: job.redirect_url,
          postedAt: parseDate(job.created),
          stipendRaw: job.salary_min ? `${job.salary_min} - ${job.salary_max} per year` : null,
          employmentType: job.contract_time ?? '',
        });
      }
    }
    return results;
  },
};

/* ------------------------------------------------------- Greenhouse (ATS) */
const greenhouse = {
  name: 'greenhouse',
  // Keyless and unlimited, per company. Curate 20-30 board tokens of companies
  // your judges will recognise -- that is what makes a demo land.
  enabled: () => env.greenhouseBoards.length > 0,
  async fetch() {
    const results = [];
    for (const board of env.greenhouseBoards) {
      try {
        const data = await getJson(
          `https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`,
        );
        for (const job of data.jobs ?? []) {
          results.push({
            title: job.title,
            company: board,
            description: stripHtml(decodeEntities(job.content ?? '')),
            locationRaw: job.location?.name ?? '',
            remote: /remote/i.test(job.location?.name ?? ''),
            applyUrl: job.absolute_url,
            postedAt: parseDate(job.updated_at),
          });
        }
      } catch (err) {
        console.warn(`[greenhouse] ${board}: ${err.message}`);
      }
    }
    return results;
  },
};

/* ------------------------------------------------------------ Lever (ATS) */
const lever = {
  name: 'lever',
  enabled: () => env.leverBoards.length > 0,
  async fetch() {
    const results = [];
    for (const board of env.leverBoards) {
      try {
        const jobs = await getJson(`https://api.lever.co/v0/postings/${board}?mode=json`);
        for (const job of jobs ?? []) {
          results.push({
            title: job.text,
            company: board,
            description: stripHtml(job.descriptionPlain ?? job.description ?? ''),
            locationRaw: job.categories?.location ?? '',
            remote: /remote/i.test(job.categories?.location ?? ''),
            applyUrl: job.hostedUrl ?? job.applyUrl,
            postedAt: parseDate(job.createdAt),
            employmentType: job.categories?.commitment ?? '',
          });
        }
      } catch (err) {
        console.warn(`[lever] ${board}: ${err.message}`);
      }
    }
    return results;
  },
};

/* ------------------------------------------------------------------ seed */
const seed = {
  name: 'seed',
  // Always on, and committed to the repo. Your demo must never depend on a
  // live third party being awake and unblocked at 10 a.m. on judging day.
  enabled: () => true,
  fetch: loadSeed,
};

export const SOURCES = [seed, remoteok, remotive, arbeitnow, adzuna, greenhouse, lever];

/** Raw adapter output -> the document we store. */
export function toOpportunity(raw, sourceName) {
  const kind = classify({
    title: raw.title ?? '',
    description: raw.description ?? '',
    employmentType: raw.employmentType ?? '',
  });
  if (!kind || !raw.title || !raw.company || !raw.applyUrl) return null;

  const location = parseLocation(raw.locationRaw ?? '', { remote: raw.remote });

  return {
    title: String(raw.title).trim().slice(0, 200),
    company: String(raw.company).trim().slice(0, 120),
    companyLogo: raw.companyLogo ?? null,
    location,
    type: kind.type,
    matchedRule: kind.matchedRule,
    description: truncate(raw.description ?? ''),
    stipend: raw.stipend ?? parseStipend(raw.stipendRaw),
    durationMonths: raw.durationMonths ?? null,
    requiredMonths: raw.requiredMonths ?? null,
    applyUrl: raw.applyUrl,
    postedAt: raw.postedAt ?? new Date(),
    source: sourceName,
  };
}

function decodeEntities(html) {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
