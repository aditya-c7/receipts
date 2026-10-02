const STAGES = ['upload', 'read', 'search', 'snapshots', 'verdict'] as const;

interface OcrProgressProps {
  stage: string;
  detail?: string;
}

export default function OcrProgress({ stage, detail }: OcrProgressProps) {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return (
    <div data-testid="ocr-progress" aria-live="polite" className="rounded border p-3 text-sm">
      <ol className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => (
          <li
            key={s}
            aria-current={s === stage ? 'step' : undefined}
            className={`rounded px-2 py-1 ${i <= idx ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            {s}
          </li>
        ))}
      </ol>
      {detail && <p className="mt-2 opacity-70">{detail}</p>}
    </div>
  );
}
