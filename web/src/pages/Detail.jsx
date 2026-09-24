import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api/client.js';
import { FitBreakdown, SkillChips } from '../components/Fit.jsx';
import { formatLocation, formatStipend, timeAgo } from '../components/OpportunityCard.jsx';
import { ErrorState, FeedSkeleton } from '../components/States.jsx';

/**
 * Show the arithmetic.
 *
 * A score a student cannot interrogate is a score they will not trust, and
 * "show me the breakdown" is the first thing a judge asks for.
 */
export default function Detail() {
  const { id } = useParams();
  const queryClient = useQueryClient();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => api.opportunity(id),
  });

  const save = useMutation({
    mutationFn: () => api.saveApplication({ opportunityId: id, scoreAtSave: data?.fit?.score }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  });

  if (isPending) return <FeedSkeleton rows={1} />;
  if (isError) return <ErrorState error={error} onRetry={refetch} />;

  const { opportunity, fit, fitError } = data;

  return (
    <div className="py-2">
      <Link to="/feed" className="text-sm text-ink-muted hover:text-ink">&larr; Back to feed</Link>

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold leading-tight">{opportunity.title}</h1>
          <p className="mt-1 text-ink-soft">
            {opportunity.company}
            <span className="text-ink-muted"> &middot; {formatLocation(opportunity.location)}</span>
          </p>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
            {formatStipend(opportunity.stipend) && <span>{formatStipend(opportunity.stipend)}</span>}
            {opportunity.durationMonths && <span>{opportunity.durationMonths} months</span>}
            {opportunity.postedAt && <span>Posted {timeAgo(opportunity.postedAt)}</span>}
            {opportunity.source && <span>via {opportunity.source}</span>}
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <a href={opportunity.applyUrl} target="_blank" rel="noopener noreferrer"
              className="btn-primary">
              Apply on {opportunity.source ?? 'the original site'}
            </a>
            <button type="button" className="btn-ghost" onClick={() => save.mutate()}
              disabled={save.isPending || save.isSuccess}>
              {save.isSuccess ? 'Saved to tracker' : save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>

          {opportunity.skillsRequired?.length > 0 && (
            <section className="mt-8">
              <h2 className="label">Skills they asked for</h2>
              <SkillChips skills={opportunity.skillsRequired} />
              {opportunity.skillsPreferred?.length > 0 && (
                <>
                  <h2 className="label mt-4">Nice to have</h2>
                  <SkillChips skills={opportunity.skillsPreferred} />
                </>
              )}
            </section>
          )}

          {opportunity.description && (
            <section className="mt-8">
              <h2 className="label">Description</h2>
              <div className="card whitespace-pre-wrap p-5 text-sm leading-relaxed text-ink-soft">
                {opportunity.description}
              </div>
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          {fit ? (
            <FitBreakdown fit={fit} />
          ) : (
            <div className="card p-5 text-sm text-ink-soft">
              {fitError ?? (
                <>
                  <p className="font-medium text-ink">No score yet</p>
                  <p className="mt-1">
                    <Link to="/onboarding" className="text-brand hover:underline">
                      Upload your résumé
                    </Link>{' '}
                    to see how well this one fits.
                  </p>
                </>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
