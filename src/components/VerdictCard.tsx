import { VERDICT_COPY } from '../../lib/verdict/copy';
import type { Verdict } from '../../lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import CheckRow from './CheckRow';

interface VerdictCardProps {
  verdict: Verdict;
}

function tierVariant(code: Verdict['code']): 'default' | 'secondary' | 'outline' {
  if (code === 'MATCH_STRONG' || code === 'MATCH_LIKELY') return 'default';
  if (code === 'MATCH_PARTIAL' || code === 'POST_EXISTS_TEXT_UNREADABLE') return 'secondary';
  return 'outline';
}

export default function VerdictCard({ verdict }: VerdictCardProps) {
  const copy = VERDICT_COPY[verdict.code] ?? { title: () => verdict.code, body: '' };
  const pct = verdict.score == null ? null : Math.round(verdict.score * 100);
  const ring = pct == null ? 0 : (pct / 100) * 2 * Math.PI * 18;

  return (
    <Card data-testid="verdict-card" aria-label="Verdict">
      <CardHeader>
        <div className="flex items-center gap-4">
          <svg width="56" height="56" viewBox="0 0 48 48" role="img" aria-label={pct == null ? 'no score' : `${pct} percent`} className="shrink-0">
            <circle cx="24" cy="24" r="18" fill="none" strokeWidth="6" className="stroke-muted" />
            <circle
              cx="24"
              cy="24"
              r="18"
              fill="none"
              strokeWidth="6"
              strokeLinecap="round"
              className="stroke-primary"
              strokeDasharray={`${ring} 999`}
              transform="rotate(-90 24 24)"
            />
          </svg>
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={tierVariant(verdict.code)}>{verdict.code.replace(/_/g, ' ')}</Badge>
              {verdict.crossCheck?.verified === true && verdict.crossCheck.verifiedBy === 'archive+x' && (
                <Badge data-testid="verified-badge" variant="default">Verified against X + archive</Badge>
              )}
              {verdict.crossCheck?.verified === true && verdict.crossCheck.verifiedBy === 'x-live' && (
                <Badge data-testid="verified-badge" variant="default">Verified against the live post on X</Badge>
              )}
            </div>
            <CardTitle data-testid="verdict-title" className="text-lg">
              {copy.title(verdict.score)}
            </CardTitle>
            <CardDescription data-testid="verdict-score">
              {pct == null ? 'Score unavailable - read the checks below.' : `Score ${pct}/100. Scores are similarity, not probability.`}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{copy.body}</p>
        <div className="space-y-1.5">
          <CheckRow label="Handle" value={verdict.checks.handle} />
          <CheckRow label="Date" value={verdict.checks.date} />
          <CheckRow label="Text" value={verdict.checks.textSim} />
        </div>
      </CardContent>
    </Card>
  );
}
