import type { DateCandidate, ParsedScreenshot } from '../../lib/types';

interface FieldEditorProps {
  parsed: ParsedScreenshot;
  onChange: (next: ParsedScreenshot) => void;
  /** True when the latest verdict was INSUFFICIENT_INPUT: point at the gaps. */
  highlightMissing?: boolean;
}

/** Normalize a hand-typed handle: strip @/spaces, lowercase (X handles are case-insensitive). */
export function normalizeHandleInput(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/**
 * Build the dates value for a hand-picked day. Preserves the previously-read
 * time-of-day when the day is unchanged (the date picker has no time
 * control — dropping the minute would silently downgrade time-consistency).
 */
export function mergeDateEdit(prev: DateCandidate | undefined, iso: string): DateCandidate[] {
  if (iso === '') return [];
  const carryTime =
    prev !== undefined && prev.isoDate === iso && prev.localMinuteOfDay !== undefined
      ? { localMinuteOfDay: prev.localMinuteOfDay }
      : {};
  return [{ isoDate: iso, raw: iso, ...carryTime }];
}

export default function FieldEditor({ parsed, onChange, highlightMissing = false }: FieldEditorProps) {
  const handle = parsed.handle.value ?? '';
  const body = parsed.text.value ?? '';
  const firstDate = parsed.dates.value?.[0]?.isoDate ?? '';
  const missingHandle = highlightMissing && handle.trim() === '';
  const missingDate = highlightMissing && (parsed.dates.value ?? []).length === 0;
  const missingBody = highlightMissing && body.trim() === '';
  const inputClass = (missing: boolean): string =>
    `mt-1 w-full rounded border px-2 py-1${missing ? ' border-red-600' : ''}`;

  function markEdited(next: ParsedScreenshot): ParsedScreenshot {
    return { ...next, fieldsEdited: true };
  }

  function onHandle(raw: string): void {
    onChange(markEdited({ ...parsed, handle: { value: normalizeHandleInput(raw), confidence: 1, source: 'user' } }));
  }

  function onDate(iso: string): void {
    const prev: DateCandidate | undefined = parsed.dates.value?.[0];
    onChange(
      markEdited({
        ...parsed,
        dates: { value: mergeDateEdit(prev, iso), confidence: 1, source: 'user' },
      }),
    );
  }

  return (
    <section data-testid="field-editor" aria-label="Edit detected fields" className="rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="language-chip" className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">
          {parsed.language || 'unknown'}
        </span>
        {parsed.fieldsEdited && (
          <span data-testid="fields-edited-badge" className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
            edited by you
          </span>
        )}
        {parsed.platform !== 'x' && (
          <label className="flex items-center gap-1 text-xs">
            <input
              data-testid="platform-override"
              type="checkbox"
              checked={false}
              onChange={() => onChange(markEdited({ ...parsed, platform: 'x' }))}
            />
            This is an X post
          </label>
        )}
      </div>
      <label className="mt-3 block text-sm">
        Handle
        <input
          data-testid="field-handle"
          className={inputClass(missingHandle)}
          aria-invalid={missingHandle}
          value={handle}
          placeholder="e.g. example_user"
          onChange={(e) => onHandle(e.target.value)}
        />
        {missingHandle && <span className="text-xs text-red-700">Enter the @handle shown in the screenshot.</span>}
      </label>
      <label className="mt-2 block text-sm">
        Post date
        <input
          data-testid="field-date"
          type="date"
          className={inputClass(missingDate)}
          aria-invalid={missingDate}
          value={firstDate}
          onChange={(e) => onDate(e.target.value)}
        />
        {missingDate && <span className="text-xs text-red-700">Pick the post date (month/year is enough to start).</span>}
      </label>
      <label className="mt-2 block text-sm">
        Post text
        <textarea
          data-testid="field-body"
          className={inputClass(missingBody)}
          aria-invalid={missingBody}
          rows={4}
          value={body}
          onChange={(e) =>
            onChange(markEdited({ ...parsed, text: { value: e.target.value, confidence: 1, source: 'user' } }))
          }
        />
        {missingBody && <span className="text-xs text-red-700">Paste or type the post text.</span>}
      </label>
    </section>
  );
}
