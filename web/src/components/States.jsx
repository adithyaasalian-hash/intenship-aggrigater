import { Link } from 'react-router-dom';

/**
 * Loading, empty and error states.
 *
 * Skeletons rather than a spinner: the page keeps its shape while it loads,
 * which reads as fast even when it is not. A spinner reads as "something might
 * be wrong", which is the last impression you want during a demo.
 */

export function FeedSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading listings">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card flex gap-4 p-5">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-full bg-paper" />
          <div className="flex-1 space-y-2.5">
            <div className="h-4 w-2/5 animate-pulse rounded bg-paper" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-paper" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-paper" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="card p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Errors say what happened and what to do about it. No apologies, no jargon. */
export function ErrorState({ error, onRetry }) {
  return (
    <div className="card border-amber-300/60 bg-amber-50 p-5">
      <p className="text-sm font-medium text-amber-900">
        {error?.message ?? 'Something went wrong.'}
      </p>
      {onRetry && (
        <button type="button" className="btn-ghost mt-3 px-3 py-1.5 text-xs" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function DegradedBanner({ reason }) {
  return (
    <div className="card mb-4 border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <strong className="font-medium">Showing newest first.</strong>{' '}
      The matching service is offline, so these listings are currently unscored.
      <Link to="/onboarding" className="ml-2 font-medium text-brand hover:underline">
        Enter skills manually
      </Link>
    </div>
  );
}
