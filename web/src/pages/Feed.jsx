import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';
import OpportunityCard from '../components/OpportunityCard.jsx';
import { DegradedBanner, EmptyState, ErrorState, FeedSkeleton } from '../components/States.jsx';

/**
 * The money screen.
 *
 * Everything here serves one thing: a student scrolling should be able to
 * decide in about a second whether a listing is worth opening. Score first,
 * reason second, everything else after.
 */
export default function Feed() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ remote: false, locations: '', minStipend: '' });

  const params = {
    remote: filters.remote || undefined,
    locations: filters.locations || undefined,
    minStipend: filters.minStipend || undefined,
    limit: 20,
  };

  const feed = useInfiniteQuery({
    queryKey: ['feed', params],
    queryFn: ({ pageParam = 0 }) => api.feed({ ...params, cursor: pageParam }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    initialPageParam: 0,
  });

  const saved = useQuery({ queryKey: ['applications'], queryFn: api.applications });
  const savedIds = new Set(
    Object.values(saved.data?.columns ?? {}).flat().map((row) => row.opportunity.id),
  );

  const save = useMutation({
    mutationFn: ({ opportunity, fit }) =>
      api.saveApplication({ opportunityId: opportunity.id, scoreAtSave: fit?.score }),
    // Optimistic in spirit: refetch the board rather than the whole feed, so
    // the list the user is reading does not jump under their thumb.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });

  const pages = feed.data?.pages ?? [];
  const items = pages.flatMap((page) => page.items);
  const meta = pages.at(-1)?.meta;
  const hasResume = user?.profile?.hasResume;

  return (
    <div className="py-2">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Your matches</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {meta?.total
              ? `${meta.total} listings ranked for your profile`
              : 'Ranked against your skills and preferences'}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          onClick={() => feed.refetch()}
          disabled={feed.isRefetching}
        >
          {feed.isRefetching ? 'Refreshing…' : 'Refresh scores'}
        </button>
      </header>

      {!hasResume && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 border-brand/25 bg-brand-soft p-4">
          <p className="flex-1 text-sm text-brand-dark">
            Upload your résumé to get real match scores instead of newest-first.
          </p>
          <Link to="/onboarding" className="btn-primary px-3 py-1.5 text-xs">Upload résumé</Link>
        </div>
      )}

      <Filters filters={filters} onChange={setFilters} />

      {meta?.degraded && <DegradedBanner reason={meta.reason} />}

      {feed.isPending && <FeedSkeleton />}

      {feed.isError && <ErrorState error={feed.error} onRetry={() => feed.refetch()} />}

      {feed.isSuccess && items.length === 0 && (
        <EmptyState
          title="No listings match those filters"
          action={
            <button type="button" className="btn-ghost"
              onClick={() => setFilters({ remote: false, locations: '', minStipend: '' })}>
              Clear filters
            </button>
          }
        >
          Try widening your location list, or lowering the minimum stipend.
        </EmptyState>
      )}

      <div className="space-y-3">
        {items.map(({ opportunity, fit }) => (
          <OpportunityCard
            key={opportunity.id}
            opportunity={opportunity}
            fit={fit}
            saved={savedIds.has(opportunity.id)}
            onSave={(o, f) => save.mutate({ opportunity: o, fit: f })}
          />
        ))}
      </div>

      {feed.hasNextPage && (
        <div className="mt-5 text-center">
          <button type="button" className="btn-ghost"
            onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {items.length > 0 && !feed.hasNextPage && (
        <p className="mt-6 text-center text-xs text-ink-muted">
          That is everything matching your filters.
        </p>
      )}
    </div>
  );
}

function Filters({ filters, onChange }) {
  return (
    <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[10rem] flex-1">
        <label className="label" htmlFor="f-loc">Locations</label>
        <input id="f-loc" className="input" placeholder="Any" value={filters.locations}
          onChange={(e) => onChange({ ...filters, locations: e.target.value })} />
      </div>
      <div className="w-36">
        <label className="label" htmlFor="f-stipend">Min stipend</label>
        <input id="f-stipend" type="number" min="0" step="1000" className="input"
          placeholder="Any" value={filters.minStipend}
          onChange={(e) => onChange({ ...filters, minStipend: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={filters.remote}
          onChange={(e) => onChange({ ...filters, remote: e.target.checked })} />
        Remote only
      </label>
    </div>
  );
}
