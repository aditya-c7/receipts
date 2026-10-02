import type { ParsedScreenshot } from '../../lib/types';

interface FieldEditorProps {
  parsed: ParsedScreenshot;
  onChange: (next: ParsedScreenshot) => void;
}

export default function FieldEditor({ parsed, onChange }: FieldEditorProps) {
  const handle = parsed.handle.value ?? '';
  const body = parsed.text.value ?? '';
  const firstDate = parsed.dates.value?.[0]?.isoDate ?? '';

  function markEdited(next: ParsedScreenshot): ParsedScreenshot {
    return { ...next, fieldsEdited: true };
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
          className="mt-1 w-full rounded border px-2 py-1"
          value={handle}
          placeholder="e.g. example_user"
          onChange={(e) =>
            onChange(markEdited({ ...parsed, handle: { value: e.target.value, confidence: 1, source: 'user' } }))
          }
        />
      </label>
      <label className="mt-2 block text-sm">
        Post date
        <input
          data-testid="field-date"
          type="date"
          className="mt-1 w-full rounded border px-2 py-1"
          value={firstDate}
          onChange={(e) => {
            const iso = e.target.value;
            onChange(
              markEdited({
                ...parsed,
                dates: {
                  value: iso ? [{ isoDate: iso, raw: iso }] : [],
                  confidence: 1,
                  source: 'user',
                },
              }),
            );
          }}
        />
      </label>
      <label className="mt-2 block text-sm">
        Post text
        <textarea
          data-testid="field-body"
          className="mt-1 w-full rounded border px-2 py-1"
          rows={4}
          value={body}
          onChange={(e) =>
            onChange(markEdited({ ...parsed, text: { value: e.target.value, confidence: 1, source: 'user' } }))
          }
        />
      </label>
    </section>
  );
}
