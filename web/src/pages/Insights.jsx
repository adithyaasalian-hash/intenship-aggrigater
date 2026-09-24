import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client.js';
import { prettySkill } from '../components/Fit.jsx';
import { EmptyState, ErrorState, FeedSkeleton } from '../components/States.jsx';

/**
 * The "so what" screen -- and the line judges remember.
 *
 * Not "you scored 62", but "learning Docker unlocks 23 more roles you are
 * already close to". This is where an aggregator becomes career guidance.
 *
 * DAY 5-6 POLISH: the bars below are plain divs. Swapping them for Recharts
 * buys you hover tooltips and a nicer axis, and nothing else in this file has
 * to change. Do it only after the demo path is solid.
 */
export default function Insights() {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['insights'],
    queryFn: api.insights,
  });

  if (isPending) return <FeedSkeleton rows={2} />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const gaps = data.gaps ?? [];
  const max = Math.max(1, ...gaps.map((g) => g.blocks));

  if (!gaps.length) {
    return (
      <EmptyState
        title="Nothing blocking you yet"
        action={<Link to="/onboarding" className="btn-primary">Upload résumé</Link>}
      >
        {data.message ??
          'Once we have your skills and a few hundred listings, this page shows which missing skill opens up the most roles.'}
      </EmptyState>
    );
  }

  return (
    <div className="py-2">
      <h1 className="text-lg font-semibold">What to learn next</h1>
      <p className="mt-1 max-w-xl text-sm text-ink-soft">
        Across the {data.consideredRoles} roles you are already in striking distance of, these are
        the skills standing between you and the rest.
      </p>

      <ul className="mt-6 space-y-4">
        {gaps.map((gap) => (
          <li key={gap.skill} className="card p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-medium">{prettySkill(gap.skill)}</h2>
              <span className="font-mono text-sm tabular-nums text-brand">
                +{gap.blocks} role{gap.blocks === 1 ? '' : 's'}
              </span>
            </div>

            <div className="mt-2 h-2 overflow-hidden rounded-full bg-paper">
              <div className="h-full rounded-full bg-brand"
                style={{ width: `${Math.round((gap.blocks / max) * 100)}%` }} />
            </div>

            {gap.examples?.length > 0 && (
              <p className="mt-2 text-xs text-ink-muted">
                e.g. {gap.examples.map((x) => `${x.title} at ${x.company}`).join('  ·  ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
