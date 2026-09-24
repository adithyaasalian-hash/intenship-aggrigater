import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { api } from '../api/client.js';
import { EmptyState, ErrorState, FeedSkeleton } from '../components/States.jsx';

const COLUMNS = [
  ['saved', 'Saved'],
  ['applied', 'Applied'],
  ['interview', 'Interview'],
  ['offer', 'Offer'],
];

/**
 * Four columns, move between them.
 *
 * DAY 5-6 POLISH: this uses a status dropdown rather than drag-and-drop, which
 * is deliberate for the scaffold -- it works on touch, it is keyboard
 * accessible, and it took twenty lines instead of a library. If you want drag,
 * @dnd-kit/core is the one to reach for, and only the column body below has to
 * change.
 */
export default function Tracker() {
  const queryClient = useQueryClient();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['applications'],
    queryFn: api.applications,
  });

  const move = useMutation({
    mutationFn: ({ id, status }) => api.updateApplication(id, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });

  const remove = useMutation({
    mutationFn: (id) => api.removeApplication(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });

  if (isPending) return <FeedSkeleton rows={2} />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  if (!data.total) {
    return (
      <EmptyState
        title="Nothing saved yet"
        action={<Link to="/feed" className="btn-primary">Browse your matches</Link>}
      >
        Save a listing from the feed and it lands here, so you can track it from
        applied through to offer.
      </EmptyState>
    );
  }

  return (
    <div className="py-2">
      <h1 className="text-lg font-semibold">Your applications</h1>
      <p className="mt-1 text-sm text-ink-soft">{data.total} tracked</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {COLUMNS.map(([key, label]) => (
          <section key={key}>
            <h2 className="label flex items-baseline justify-between">
              {label}
              <span className="font-mono">{data.columns[key]?.length ?? 0}</span>
            </h2>

            <div className="space-y-2">
              {(data.columns[key] ?? []).map((row) => (
                <article key={row.id} className="card p-3">
                  <Link to={`/opportunity/${row.opportunity.id}`}
                    className="block text-sm font-medium leading-snug hover:text-brand">
                    {row.opportunity.title}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{row.opportunity.company}</p>

                  {row.scoreAtSave != null && (
                    <p className="mt-1 font-mono text-xs text-brand">
                      {row.scoreAtSave} when saved
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-2">
                    <select
                      className="input px-2 py-1 text-xs"
                      value={row.status}
                      onChange={(e) => move.mutate({ id: row.id, status: e.target.value })}
                      aria-label={`Status for ${row.opportunity.title}`}
                    >
                      {['saved', 'applied', 'interview', 'offer', 'rejected'].map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <button type="button" className="text-xs text-ink-muted hover:text-ink"
                      onClick={() => remove.mutate(row.id)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))}

              {!data.columns[key]?.length && (
                <p className="rounded-card border border-dashed border-paper-rule p-3 text-xs text-ink-muted">
                  Nothing here
                </p>
              )}
            </div>
          </section>
        ))}
      </div>

      {data.columns.rejected?.length > 0 && (
        <p className="mt-6 text-xs text-ink-muted">
          {data.columns.rejected.length} archived as rejected.
        </p>
      )}
    </div>
  );
}
