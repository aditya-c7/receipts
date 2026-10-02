import { VERDICT_COPY } from '../../lib/verdict/copy';
import type { Verdict } from '../../lib/types';
import CheckRow from './CheckRow';

interface VerdictCardProps {
  verdict: Verdict;
}

export default function VerdictCard({ verdict }: VerdictCardProps) {
  const copy = VERDICT_COPY[verdict.code] ?? { title: () => verdict.code, body: '' };
  const pct = verdict.score == null ? null : Math.round(verdict.score * 100);
  const ring = pct == null ? 0 : (pct / 100) * 2 * Math.PI * 18;

  return (
    <section data-testid="verdict-card" aria-label="Verdict" className="rounded border p-4">
      <div className="flex items-center gap-3">
        <svg width="48" height="48" viewBox="0 0 48 48" role="img" aria-label={pct == null ? 'no score' : `${pct} percent`}>
          <circle cx="24" cy="24" r="18" fill="none" strokeWidth="6" className="stroke-gray-200 dark:stroke-gray-700" />
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className="stroke-black dark:stroke-white"
            strokeDasharray={`${ring} 999`}
            transform="rotate(-90 24 24)"
          />
        </svg>
        <div>
          <h2 data-testid="verdict-title" className="text-lg font-bold">
            {copy.title(verdict.score)}
          </h2>
          <p data-testid="verdict-score" className="text-sm opacity-70">
            {pct == null ? 'Score unavailable — read the checks below.' : `Score ${pct}/100. Scores are similarity, not probability.`}
          </p>
        </div>
      </div>
      <p className="mt-2 text-sm">{copy.body}</p>
      <div className="mt-3 space-y-1">
        <CheckRow label="Handle" value={verdict.checks.handle} />
        <CheckRow label="Date" value={verdict.checks.date} />
        <CheckRow label="Text" value={verdict.checks.textSim} />
      </div>
    </section>
  );
}
