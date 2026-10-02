import type { ParsedScreenshot } from '../../lib/types';
import archived1 from '../examples/archived-1.json';
import archived2 from '../examples/archived-2.json';
import archived3 from '../examples/archived-3.json';
import noMatch from '../examples/no-match.json';

interface ExamplePickerProps {
  onPick: (parsed: ParsedScreenshot) => void;
}

function coerce(json: unknown): ParsedScreenshot {
  const r = json as Record<string, Record<string, unknown> | unknown>;
  const field = (v: unknown): { value: string | null } => ({ value: typeof v === 'string' ? v : null });
  const rec = (k: string): Record<string, unknown> =>
    typeof r[k] === 'object' && r[k] !== null ? (r[k] as Record<string, unknown>) : {};
  const datesRaw = rec('dates').value;
  const datesArr = Array.isArray(datesRaw) ? datesRaw : [];
  const isoFirst = datesArr[0] as Record<string, unknown> | undefined;
  return {
    platform: 'x',
    displayName: { value: field(rec('displayName').value).value, confidence: 0.9, source: 'ocr' },
    handle: { value: field(rec('handle').value).value, confidence: 0.9, source: 'ocr' },
    text: { value: field(rec('text').value).value, confidence: 0.9, source: 'ocr' },
    dates: {
      value: typeof isoFirst?.isoDate === 'string' ? [{ isoDate: isoFirst.isoDate, raw: String(isoFirst.raw ?? '') }] : [],
      confidence: 0.85,
      source: 'ocr',
    },
    language: typeof r.language === 'string' ? r.language : 'en',
    ocrMs: 0,
    fieldsEdited: false,
  };
}

export default function ExamplePicker({ onPick }: ExamplePickerProps) {
  const items: Array<{ label: string; data: unknown }> = [
    { label: 'Example 1 (archived)', data: archived1 },
    { label: 'Example 2 (archived)', data: archived2 },
    { label: 'Example 3 (archived)', data: archived3 },
    { label: 'Example 4 (no match)', data: noMatch },
  ];
  return (
    <div data-testid="example-picker" className="flex flex-wrap gap-2">
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className="rounded border px-3 py-1 text-sm underline"
          onClick={() => onPick(coerce(it.data))}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
