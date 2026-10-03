import { Badge } from './ui/badge';

interface DiffViewProps {
  diff: Array<{ op: 'eq' | 'del' | 'ins'; text: string }>;
}

/** Neutral word diff: Ins = only in archive, Del = only in screenshot. */
export default function DiffView({ diff }: DiffViewProps) {
  return (
    <div data-testid="diff-view" aria-label="Text differences" className="space-y-2 text-sm">
      <p className="text-muted-foreground text-xs">Ins = text only in the archive. Del = text only in your screenshot.</p>
      <div className="space-y-1">
        {diff.map((d, i) => (
          <div key={i} className="flex gap-2">
            <Badge
              variant="outline"
              className={
                d.op === 'ins'
                  ? 'w-9 shrink-0 justify-center bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : d.op === 'del'
                    ? 'w-9 shrink-0 justify-center bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : 'w-9 shrink-0 justify-center'
              }
            >
              {d.op === 'ins' ? 'Ins' : d.op === 'del' ? 'Del' : '='}
            </Badge>
            <span className="whitespace-pre-wrap">{d.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
