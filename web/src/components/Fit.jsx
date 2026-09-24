import { useEffect, useState } from 'react';

/**
 * The one component worth building carefully.
 *
 * It appears on every card, on the detail page, and on the tracker, so it gets
 * built once and properly. Two rules govern it:
 *
 * 1. Never encode the band in colour alone. Every badge carries its number and
 *    its word, so it survives greyscale printing and colour blindness.
 * 2. Missing skills are never red. Red says "you failed". The whole posture of
 *    this product is "here is what to learn next", and the colour has to agree
 *    with the copy.
 */

const BAND = {
  strong: { label: 'Strong match', text: 'text-band-strong', ring: 'stroke-band-strong', bg: 'bg-brand-soft' },
  good: { label: 'Good match', text: 'text-band-good', ring: 'stroke-band-good', bg: 'bg-blue-50' },
  fair: { label: 'Worth a look', text: 'text-band-fair', ring: 'stroke-band-fair', bg: 'bg-amber-50' },
  weak: { label: 'Long shot', text: 'text-band-weak', ring: 'stroke-band-weak', bg: 'bg-paper' },
};

const bandOf = (band) => BAND[band] ?? BAND.weak;

/** Animated score ring. Counts up once on mount, then never again. */
export function FitBadge({ fit, size = 56 }) {
  const [shown, setShown] = useState(0);
  const target = fit?.score ?? 0;

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return setShown(target);

    let frame;
    const started = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / 600);
      // ease-out cubic, so it decelerates into the final number
      setShown(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  if (!fit) {
    return (
      <div
        className="grid place-items-center rounded-full border border-dashed border-paper-rule text-xs text-ink-muted"
        style={{ width: size, height: size }}
        title="Upload a résumé to see your fit"
      >
        --
      </div>
    );
  }

  const band = bandOf(fit.band);
  const radius = size / 2 - 4;
  const circumference = 2 * Math.PI * radius;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      title={`${fit.score} out of 100 - ${band.label}`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none"
          className="stroke-paper-rule" strokeWidth="4" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          className={band.ring} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
        />
      </svg>
      <span
        className={`absolute inset-0 grid place-items-center font-mono font-medium ${band.text}`}
        style={{ fontSize: size / 3.4 }}
      >
        {shown}
      </span>
      <span className="sr-only">{`Fit score ${fit.score} out of 100, ${band.label}`}</span>
    </div>
  );
}

export function BandChip({ band }) {
  const style = bandOf(band);
  return (
    <span className={`chip border-transparent ${style.bg} ${style.text}`}>{style.label}</span>
  );
}

/** Matched in the brand tone, missing in a neutral warning tone. Never red. */
export function SkillChips({ skills = [], tone = 'neutral', limit }) {
  const shown = limit ? skills.slice(0, limit) : skills;
  const overflow = limit ? skills.length - shown.length : 0;

  const tones = {
    matched: 'border-brand/25 bg-brand-soft text-brand-dark',
    missing: 'border-amber-300/60 bg-amber-50 text-amber-800',
    neutral: 'border-paper-rule bg-paper text-ink-soft',
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((skill) => (
        <span key={skill} className={`chip ${tones[tone]}`}>{prettySkill(skill)}</span>
      ))}
      {overflow > 0 && <span className="chip border-paper-rule text-ink-muted">+{overflow}</span>}
    </div>
  );
}

/**
 * The full arithmetic, shown on the detail page.
 *
 * Showing the working is the point: a score a student cannot interrogate is a
 * score they will not trust, and "show the breakdown" is the first thing a
 * judge asks for.
 */
export function FitBreakdown({ fit }) {
  if (!fit) return null;

  const rows = [
    ['Skills', 'skills', 0.45, 'How many of the listed skills you already have'],
    ['Description match', 'semantic', 0.25, 'How close your résumé reads to this posting'],
    ['Experience', 'seniority', 0.12, 'Whether your experience matches what they asked for'],
    ['Location', 'location', 0.10, 'Against your saved location preferences'],
    ['Freshness', 'freshness', 0.08, 'How recently this was posted'],
  ];

  return (
    <div className="card p-5">
      <div className="flex items-start gap-4">
        <FitBadge fit={fit} size={72} />
        <div className="min-w-0">
          <BandChip band={fit.band} />
          <p className="mt-2 text-sm text-ink-soft">{fit.reason}</p>
        </div>
      </div>

      <dl className="mt-5 space-y-3">
        {rows.map(([label, key, weight, help]) => {
          const value = fit.components?.[key] ?? 0;
          return (
            <div key={key}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="font-medium" title={help}>{label}</dt>
                <dd className="font-mono text-xs tabular-nums text-ink-muted">
                  {Math.round(value * 100)}% × {weight}
                </dd>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(2, Math.round(value * 100))}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-muted">{help}</p>
            </div>
          );
        })}
      </dl>

      {fit.matched?.length > 0 && (
        <div className="mt-5">
          <p className="label">You have</p>
          <SkillChips skills={fit.matched} tone="matched" />
        </div>
      )}
      {fit.missing?.length > 0 && (
        <div className="mt-4">
          <p className="label">Worth learning</p>
          <SkillChips skills={fit.missing} tone="missing" />
        </div>
      )}
    </div>
  );
}

const SPECIAL = {
  cpp: 'C++', csharp: 'C#', nodejs: 'Node.js', nextjs: 'Next.js', nestjs: 'NestJS',
  fastapi: 'FastAPI', graphql: 'GraphQL', postgresql: 'PostgreSQL', mongodb: 'MongoDB',
  aws: 'AWS', gcp: 'GCP', sql: 'SQL', nlp: 'NLP', llm: 'LLM', ci_cd: 'CI/CD',
  rest_api: 'REST APIs', ui_design: 'UI design', ux_design: 'UX design', html: 'HTML',
  css: 'CSS', seo: 'SEO', oop: 'OOP', etl: 'ETL', mlops: 'MLOps', powerbi: 'Power BI',
  web3: 'Web3', crm: 'CRM', grpc: 'gRPC', r: 'R', dbt: 'dbt',
};

export function prettySkill(skill = '') {
  return SPECIAL[skill] ?? skill.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
