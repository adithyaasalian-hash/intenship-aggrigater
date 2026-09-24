import { Link } from 'react-router-dom';
import { FitBadge, SkillChips } from './Fit.jsx';

export function formatStipend(stipend) {
  if (!stipend) return null;
  if (stipend.max === 0) return 'Unpaid';
  const symbol = { INR: '\u20b9', USD: '$', EUR: '\u20ac' }[stipend.currency] ?? '';
  const compact = (n) =>
    n >= 100000 ? `${(n / 100000).toFixed(1)}L` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
  const range =
    stipend.min && stipend.max && stipend.min !== stipend.max
      ? `${compact(stipend.min)}-${compact(stipend.max)}`
      : compact(stipend.max || stipend.min);
  return `${symbol}${range}/mo`;
}

export function formatLocation(location) {
  if (!location) return 'Location not stated';
  if (location.remote) return 'Remote';
  const parts = [location.city, location.state].filter(Boolean);
  if (!parts.length) return location.raw || 'Location not stated';
  return parts.map((p) => p.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ');
}

export function timeAgo(date) {
  if (!date) return null;
  const days = Math.floor((Date.now() - new Date(date)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * One row in the feed.
 *
 * Reading order is deliberate: title, then score, then the reason. A student
 * scanning quickly should be able to answer "am I qualified?" before they have
 * read the company name.
 */
export default function OpportunityCard({ opportunity, fit, onSave, saved }) {
  const stipend = formatStipend(opportunity.stipend);

  return (
    <article className="card p-4 transition-shadow hover:shadow-sm sm:p-5">
      <div className="flex gap-4">
        <FitBadge fit={fit} />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate font-semibold leading-snug">
                <Link to={`/opportunity/${opportunity.id}`} className="hover:text-brand">
                  {opportunity.title}
                </Link>
              </h3>
              <p className="mt-0.5 truncate text-sm text-ink-soft">
                {opportunity.company}
                <span className="text-ink-muted"> &middot; {formatLocation(opportunity.location)}</span>
              </p>
            </div>

            {onSave && (
              <button
                type="button"
                onClick={() => onSave(opportunity, fit)}
                className="btn-ghost shrink-0 px-3 py-1 text-xs"
                aria-pressed={Boolean(saved)}
              >
                {saved ? 'Saved' : 'Save'}
              </button>
            )}
          </div>

          {fit?.reason && <p className="mt-2 text-sm text-ink-soft">{fit.reason}</p>}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-muted">
            {stipend && <span>{stipend}</span>}
            {opportunity.durationMonths && <span>{opportunity.durationMonths} months</span>}
            {opportunity.type === 'fresher' && <span>Entry level</span>}
            {opportunity.postedAt && <span>{timeAgo(opportunity.postedAt)}</span>}
            {opportunity.source && <span className="text-ink-muted/70">via {opportunity.source}</span>}
          </div>

          {fit?.missing?.length > 0 ? (
            <div className="mt-3">
              <SkillChips skills={fit.missing} tone="missing" limit={4} />
            </div>
          ) : (
            opportunity.skillsRequired?.length > 0 && (
              <div className="mt-3">
                <SkillChips skills={opportunity.skillsRequired} limit={5} />
              </div>
            )
          )}
        </div>
      </div>
    </article>
  );
}
