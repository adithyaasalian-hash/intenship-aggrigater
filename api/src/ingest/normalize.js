import crypto from 'node:crypto';

/**
 * Everything that turns one source's idea of a job into ours.
 *
 * Adapters call these and return a plain object; they never touch the
 * database. A single writer does the upsert. That is what makes adding a
 * seventh source on day four one small file instead of a refactor.
 */

/* ------------------------------------------------------------ fingerprint */

const stripNoise = (value = '') =>
  value
    .toLowerCase()
    .replace(/\((intern|internship|remote|hybrid|contract|f\/m\/d|m\/f\/d|w\/m\/d)\)/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * sha1(title | company | first 12 chars of location).
 *
 * Exact matching catches most duplicates because the same posting genuinely
 * repeats verbatim across aggregators -- they are all reading the same ATS
 * feeds. Truncating the location absorbs "Bengaluru" vs "Bengaluru, KA".
 */
export function fingerprint({ title, company, location }) {
  // Only the first token of the place. "Bengaluru", "Bengaluru, KA" and
  // "Bengaluru, Karnataka, India" all reduce to "bengaluru", which is what
  // makes the same posting from three different aggregators collapse into one
  // row. Anything longer and the state suffix splits them apart again.
  const place = stripNoise(
    typeof location === 'string' ? location : location?.city ?? location?.raw ?? '',
  ).split(' ')[0] ?? '';
  return crypto
    .createHash('sha1')
    .update(`${stripNoise(title)}|${stripNoise(company)}|${place}`)
    .digest('hex');
}

/* --------------------------------------------------------- internship gate
 * Most of these feeds are general job boards, so filter on the way in rather
 * than storing noise. We record which rule fired so the filter can be tuned
 * from evidence instead of guesswork.
 */

const INTERNSHIP = /\b(intern|internships?|apprentice|co-?op|summer analyst)\b/i;
// "Trainee" on its own almost always means a full-time graduate programme in
// Indian listings, not a summer internship -- so it belongs here, and is only
// reached when the title did not already say "intern".
const FRESHER = /\b(fresher|graduate|trainee|entry[\s-]?level|campus|new\s?grad|junior)\b/i;
const SENIOR = /\b(senior|staff|principal|lead|manager|director|head of|architect|sr\.?)\b/i;

export function classify({ title = '', description = '', employmentType = '' }) {
  const haystack = `${title} ${employmentType}`;

  // A "Senior Engineer (Internship Programme Mentor)" is not an internship.
  if (SENIOR.test(title)) return null;

  if (INTERNSHIP.test(haystack)) return { type: 'internship', matchedRule: 'title:intern' };
  if (FRESHER.test(haystack)) return { type: 'fresher', matchedRule: 'title:fresher' };

  // Only trust the description when the title said nothing either way, and
  // only near the top, where a real "this is an internship" line would be.
  const opening = description.slice(0, 400);
  if (INTERNSHIP.test(opening)) return { type: 'internship', matchedRule: 'description:intern' };

  return null;
}

/* ------------------------------------------------------------------ text */

export function stripHtml(html = '') {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* -------------------------------------------------------------- location */

const INDIAN_CITY_TO_STATE = {
  bengaluru: 'karnataka', bangalore: 'karnataka', mysuru: 'karnataka',
  mumbai: 'maharashtra', pune: 'maharashtra', nagpur: 'maharashtra', nashik: 'maharashtra',
  hyderabad: 'telangana', warangal: 'telangana',
  chennai: 'tamil nadu', coimbatore: 'tamil nadu', madurai: 'tamil nadu',
  delhi: 'delhi', 'new delhi': 'delhi', noida: 'uttar pradesh', ghaziabad: 'uttar pradesh',
  lucknow: 'uttar pradesh', kanpur: 'uttar pradesh',
  gurugram: 'haryana', gurgaon: 'haryana', faridabad: 'haryana',
  kolkata: 'west bengal', ahmedabad: 'gujarat', surat: 'gujarat', vadodara: 'gujarat',
  jaipur: 'rajasthan', indore: 'madhya pradesh', bhopal: 'madhya pradesh',
  kochi: 'kerala', thiruvananthapuram: 'kerala', chandigarh: 'chandigarh',
  bhubaneswar: 'odisha', visakhapatnam: 'andhra pradesh', patna: 'bihar',
};

const REMOTE = /\b(remote|work from home|wfh|anywhere|distributed)\b/i;

// Enough to stop a country name being mistaken for a city. "Remote, India"
// must not come back with city="india", or every remote listing gets filed
// under a city that does not exist and location filters quietly break.
const COUNTRIES = new Set([
  'india', 'usa', 'us', 'united states', 'uk', 'united kingdom', 'canada',
  'germany', 'france', 'netherlands', 'singapore', 'australia', 'ireland',
  'spain', 'poland', 'worldwide', 'global', 'europe', 'emea', 'apac',
]);

export function parseLocation(raw = '', { remote } = {}) {
  const text = String(raw).trim();
  const isRemote = remote === true || REMOTE.test(text);

  // "Bengaluru, Karnataka, India" -> ["bengaluru", "karnataka", "india"]
  const parts = text
    .split(/[,|/]/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p && !REMOTE.test(p) && p !== 'hybrid' && p !== 'on-site' && p !== 'onsite');

  // A leading country means there is no city here at all.
  let leadingCountry = null;
  while (parts.length && COUNTRIES.has(parts[0])) leadingCountry = parts.shift();

  const city = parts[0] ?? null;
  let state = parts[1] ?? null;
  let country = parts[2] ?? leadingCountry ?? null;

  // "Bengaluru, India" puts the country where the state should be.
  if (state && COUNTRIES.has(state)) {
    country = state;
    state = null;
  }

  if (city && INDIAN_CITY_TO_STATE[city]) {
    state = INDIAN_CITY_TO_STATE[city];
    country = country ?? 'india';
  }

  return { city, state, country, remote: isRemote, raw: text || (isRemote ? 'Remote' : '') };
}

/* --------------------------------------------------------------- stipend */

const NUMBER = /(?:₹|rs\.?|inr|\$|usd|€)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|lpa|lakh|lakhs)?/gi;

/**
 * Best-effort stipend parse. Returns null rather than guessing when the text
 * is ambiguous -- a wrong number on a card is worse than no number, because
 * the student makes a decision on it.
 */
export function parseStipend(raw) {
  if (!raw) return null;
  const text = String(raw).toLowerCase();
  if (/unpaid|no stipend/.test(text)) {
    return { min: 0, max: 0, currency: 'INR', period: 'month' };
  }

  const currency = /\$|usd/.test(text) ? 'USD' : /€|eur/.test(text) ? 'EUR' : 'INR';
  const perYear = /\b(per year|\/year|annum|p\.a\.|lpa|yearly)\b/.test(text);
  const values = [];

  for (const match of text.matchAll(NUMBER)) {
    let value = Number(match[1].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const suffix = (match[2] ?? '').toLowerCase();
    if (suffix === 'k') value *= 1000;
    if (suffix === 'lpa' || suffix.startsWith('lakh')) value *= 100000;
    if (value >= 1000) values.push(value);
  }
  if (!values.length) return null;

  let [min, max] = [Math.min(...values), Math.max(...values)];
  if (perYear || /lpa|lakh/.test(text)) { min = Math.round(min / 12); max = Math.round(max / 12); }

  return { min, max, currency, period: 'month' };
}

/* ------------------------------------------------------------------ dates */

export function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(
    typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : value,
  );
  if (Number.isNaN(date.valueOf())) return null;
  // A "posted 2031" row is a parse error, not a very forward-looking company.
  const year = date.getUTCFullYear();
  if (year < 2015 || year > new Date().getUTCFullYear() + 1) return null;
  return date;
}

export function truncate(text = '', limit = 8000) {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
