interface DiffViewProps {
  diff: Array<{ op: 'eq' | 'del' | 'ins'; text: string }>;
}

/** Neutral word diff: Ins = only in archive, Del = only in screenshot. */
export default function DiffView({ diff }: DiffViewProps) {
  return (
    <div data-testid="diff-view" aria-label="Text differences" className="rounded border p-3 text-sm">
      <p className="mb-2 text-xs opacity-60">Ins = text only in the archive. Del = text only in your screenshot.</p>
      <div className="space-y-1">
        {diff.map((d, i) => (
          <div key={i} className="flex gap-2">
            <span
              className={`inline-block w-8 shrink-0 rounded px-1 text-center text-xs ${
                d.op === 'ins' ? 'bg-sky-100 text-sky-900' : d.op === 'del' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {d.op === 'ins' ? 'Ins' : d.op === 'del' ? 'Del' : '='}
            </span>
            <span className="whitespace-pre-wrap">{d.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
