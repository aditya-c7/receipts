interface CheckRowProps {
  label: string;
  value: boolean | null | number;
  hint?: string;
}

function renderValue(v: boolean | null | number): { text: string } {
  if (typeof v === 'number') return { text: `${Math.round(v * 100)}% similar` };
  if (v === true) return { text: 'Yes' };
  if (v === false) return { text: 'No' };
  return { text: 'Unknown' };
}

export default function CheckRow({ label, value, hint }: CheckRowProps) {
  const r = renderValue(value);
  return (
    <div data-testid="check-row" aria-label={`${label}: ${r.text}`} className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className="text-muted-foreground inline-block w-5 shrink-0 text-center font-bold">
        {value === true ? '✓' : value === false ? '✗' : value === null ? '?' : '≈'}
      </span>
      <div>
        <span className="font-medium">{label}:</span> <span>{r.text}</span>
        {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
      </div>
    </div>
  );
}
