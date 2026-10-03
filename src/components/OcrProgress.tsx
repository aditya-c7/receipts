import { Badge } from './ui/badge';
import { Progress } from './ui/progress';

const STAGES = ['upload', 'read', 'search', 'snapshots', 'verdict'] as const;

interface OcrProgressProps {
  stage: string;
  detail?: string;
}

export default function OcrProgress({ stage, detail }: OcrProgressProps) {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const m = detail !== undefined ? /Compared (\d+) of (\d+)/.exec(detail) : null;
  const frac = m !== null && Number(m[2]) > 0 ? Math.min(1, Number(m[1]) / Number(m[2])) : null;
  return (
    <div data-testid="ocr-progress" aria-live="polite" className="space-y-2">
      <ol className="flex flex-wrap gap-1.5">
        {STAGES.map((s, i) => (
          <li key={s} aria-current={s === stage ? 'step' : undefined}>
            <Badge variant={i < idx ? 'default' : i === idx ? 'secondary' : 'outline'}>{s}</Badge>
          </li>
        ))}
      </ol>
      {frac !== null && <Progress value={Math.round(frac * 100)} aria-label={detail} />}
      {detail && frac === null && <p className="text-muted-foreground text-sm">{detail}</p>}
    </div>
  );
}
