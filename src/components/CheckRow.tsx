interface CheckRowProps {
  label: string;
  value: boolean | null | number;
  hint?: string;
}

function renderValue(v: boolean | null | number): { glyph: string; text: string } {
  if (typeof v === 'number') return { glyph: '≈', text: `${Math.round(v * 100)}% similar` };
  if (v === true) return { glyph: '✓', text: 'Yes' };
  if (v === false) return { glyph: '✗', text: 'No' };
  return { glyph: '?', text: 'Unknown' };
}

export default function CheckRow({ label, value, hint }: CheckRowProps) {
  const r = renderValue(value);
  return (
    <div data-testid="check-row" aria-label={`${label}: ${r.text}`} className="flex items-start gap-2 text-sm">
      <span aria-hidden="true" className="inline-block w-5 text-center">
        {r.glyph}
      </span>
      <div>
        <span className="font-medium">{label}:</span> <span>{r.text}</span>
        {hint && <div className="text-xs opacity-60">{hint}</div>}
      </div>
    </div>
  );
}
