import { Languages } from 'lucide-react';
import type { DateCandidate, ParsedScreenshot } from '../../lib/types';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label } from './ui/label';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';

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
 * control - dropping the minute would silently downgrade time-consistency).
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
  const uncertainHandle =
    !missingHandle && parsed.handle.source === 'ocr' && parsed.handle.confidence < 0.5;

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
    <section data-testid="field-editor" aria-label="Edit detected fields" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" data-testid="language-chip">
          <Languages />
          {parsed.language || 'unknown'}
        </Badge>
        {parsed.fieldsEdited && (
          <Badge variant="outline" data-testid="fields-edited-badge">
            edited by you
          </Badge>
        )}
        {parsed.platform !== 'x' && (
          <Label className="cursor-pointer gap-1.5 text-xs font-normal">
            <Checkbox
              data-testid="platform-override"
              checked={false}
              onCheckedChange={() => onChange(markEdited({ ...parsed, platform: 'x' }))}
            />
            This is an X post
          </Label>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="field-handle">Handle</Label>
        <Input
          id="field-handle"
          data-testid="field-handle"
          aria-invalid={missingHandle}
          value={handle}
          placeholder="e.g. example_user"
          onChange={(e) => onHandle(e.target.value)}
        />
        {missingHandle && <p className="text-destructive text-xs">Enter the @handle shown in the screenshot.</p>}
        {!missingHandle && uncertainHandle && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Handle looks uncertain - please verify it letter by letter.</p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="field-date">Post date</Label>
        <Input
          id="field-date"
          data-testid="field-date"
          type="date"
          aria-invalid={missingDate}
          value={firstDate}
          onChange={(e) => onDate(e.target.value)}
        />
        {missingDate && <p className="text-destructive text-xs">Pick the post date (month/year is enough to start).</p>}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="field-body">Post text</Label>
        <Textarea
          id="field-body"
          data-testid="field-body"
          aria-invalid={missingBody}
          rows={4}
          value={body}
          onChange={(e) =>
            onChange(markEdited({ ...parsed, text: { value: e.target.value, confidence: 1, source: 'user' } }))
          }
        />
        {missingBody && <p className="text-destructive text-xs">Paste or type the post text.</p>}
      </div>
    </section>
  );
}
