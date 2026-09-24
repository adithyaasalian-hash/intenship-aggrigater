import { env } from '../config/env.js';

/**
 * Thin client for the Python service.
 *
 * Two things it does that a bare fetch() does not:
 *
 * 1. Times out. A free-tier container waking from sleep can hang for a minute;
 *    without an AbortController the Express request hangs with it and the user
 *    stares at a spinner during your demo.
 * 2. Fails soft where it can. If the ML service is down, the feed should still
 *    render newest-first with a banner, not 500. A degraded feed is a demo you
 *    can talk over; a stack trace is not.
 */

class MlError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = 'MlError';
  }
}

async function call(path, { method = 'POST', body, formData, timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? env.mlTimeoutMs);

  try {
    const response = await fetch(`${env.mlUrl}${path}`, {
      method,
      signal: controller.signal,
      ...(formData
        ? { body: formData }
        : body !== undefined
          ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          : {}),
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      // FastAPI puts the message in `detail`. Pass 4xx through verbatim so the
      // user sees "this PDF is a scan" rather than "upstream error".
      throw new MlError(payload?.detail ?? `ML service returned ${response.status}`,
        response.status);
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new MlError('The matching service took too long to respond.', 504);
    }
    if (err instanceof MlError) throw err;
    throw new MlError(`Could not reach the matching service: ${err.message}`, 503);
  } finally {
    clearTimeout(timer);
  }
}

export const ml = {
  health: () => call('/health', { method: 'GET', timeoutMs: 5000 }),
  reindex: () => call('/reindex', { timeoutMs: 20000 }),

  embed: (texts) => call('/embed', { body: { texts }, timeoutMs: 120000 }),
  extractSkills: (texts) => call('/extract-skills', { body: { texts }, timeoutMs: 60000 }),

  parseResume: (buffer, filename, contentType = 'application/pdf') => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);
    return call('/parse', { formData: form, timeoutMs: 60000 });
  },

  score: (profile, opportunityIds) => call('/score', { body: { profile, opportunityIds } }),
  recommend: (payload) => call('/recommend', { body: payload }),
  skillGap: (payload) => call('/skill-gap', { body: payload }),
};

/**
 * Warm the model without blocking anything.
 *
 * Called on API boot and by the frontend on app load. A free-tier Python host
 * sleeps after ~15 minutes idle and needs 30-50 seconds to wake -- you want
 * that happening while someone reads your landing page, not while a judge
 * watches a résumé upload spinner.
 */
export async function warmUp({ retries = 3, delayMs = 5000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const health = await ml.health();
      console.log(
        `[ml] ready model=${health.model} dim=${health.dim} indexed=${health.indexedOpportunities}` +
        (health.degraded ? ' DEGRADED (hashing fallback -- fix before demoing)' : ''),
      );
      return health;
    } catch (err) {
      console.warn(`[ml] warm-up ${attempt}/${retries} failed: ${err.message}`);
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.warn('[ml] still unreachable; the feed will fall back to newest-first');
  return null;
}

export { MlError };
