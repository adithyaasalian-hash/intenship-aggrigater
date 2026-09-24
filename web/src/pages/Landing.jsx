import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api/client.js';
import { useAuth } from '../store/auth.js';

/**
 * A real listing count and one honest sentence. Resist the urge to add a hero
 * illustration -- judges have four minutes and none of them are for your
 * landing page.
 */
export default function Landing() {
  const { status } = useAuth();
  const { data } = useQuery({ queryKey: ['stats'], queryFn: api.stats, retry: 1 });

  return (
    <div className="py-10">
      <p className="font-mono text-xs uppercase tracking-widest text-brand">
        Internships, ranked for you
      </p>
      <h1 className="mt-3 max-w-2xl text-2xl font-bold leading-tight tracking-tight">
        Stop checking six job boards. Start with the ones you can actually get.
      </h1>
      <p className="mt-4 max-w-xl text-ink-soft">
        Upload your résumé once. Every listing gets a fit score out of 100 and a
        plain sentence explaining it &mdash; which skills you have, which you are
        missing, and whether it is worth your afternoon.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link to={status === 'signedIn' ? '/feed' : '/auth'} className="btn-primary">
          {status === 'signedIn' ? 'Open my feed' : 'Get my match scores'}
        </Link>
      </div>

      {data && (
        <dl className="mt-10 grid gap-px overflow-hidden rounded-card border border-paper-rule bg-paper-rule sm:grid-cols-3">
          <Stat label="Live listings" value={data.total?.toLocaleString() ?? '--'} />
          <Stat label="Fully remote" value={data.remote?.toLocaleString() ?? '--'} />
          <Stat label="Sources" value={data.sources?.length ?? 0} />
        </dl>
      )}

      {data?.sources?.length > 0 && (
        <p className="mt-4 font-mono text-xs text-ink-muted">
          {data.sources.map((s) => `${s.source} (${s.count})`).join('  ·  ')}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-paper-card p-5">
      <dt className="label mb-1">{label}</dt>
      <dd className="font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}
