import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import FieldEditor, { normalizeHandleInput, mergeDateEdit } from '../../src/components/FieldEditor';
import type { ParsedScreenshot } from '../../lib/types';

afterEach(() => {
  cleanup();
});

function fixture(): ParsedScreenshot {
  return {
    platform: 'x',
    displayName: { value: 'Polymarket', confidence: 0.9, source: 'ocr' },
    handle: { value: 'polymarket', confidence: 0.9, source: 'ocr' },
    text: { value: 'hello world', confidence: 0.9, source: 'ocr' },
    dates: {
      value: [{ isoDate: '2026-10-03', localMinuteOfDay: 507, raw: '8:27 AM · Oct 3, 2026' }],
      confidence: 0.8,
      source: 'ocr',
    },
    language: 'eng',
    ocrMs: 100,
    fieldsEdited: false,
  };
}

describe('normalizeHandleInput', () => {
  it('strips @/spaces and lowercases', () => {
    expect(normalizeHandleInput('@POLYMARKET ')).toBe('polymarket');
    expect(normalizeHandleInput('  @@Ab_C9')).toBe('ab_c9');
    expect(normalizeHandleInput('')).toBe('');
  });
});

describe('FieldEditor', () => {
  it('normalizes a hand-typed handle', () => {
    const onChange = vi.fn();
    render(<FieldEditor parsed={fixture()} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('field-handle'), { target: { value: '@PolyMarket ' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as ParsedScreenshot;
    expect(next.handle.value).toBe('polymarket');
    expect(next.handle.source).toBe('user');
    expect(next.fieldsEdited).toBe(true);
  });

describe('mergeDateEdit', () => {
  const prev = { isoDate: '2026-10-03', localMinuteOfDay: 507, raw: '8:27 AM · Oct 3, 2026' };
  it('preserves time-of-day when the day is unchanged', () => {
    expect(mergeDateEdit(prev, '2026-10-03')).toEqual([
      { isoDate: '2026-10-03', raw: '2026-10-03', localMinuteOfDay: 507 },
    ]);
  });
  it('drops time-of-day when the day changes', () => {
    expect(mergeDateEdit(prev, '2026-10-04')).toEqual([{ isoDate: '2026-10-04', raw: '2026-10-04' }]);
  });
  it('clears on empty input', () => {
    expect(mergeDateEdit(prev, '')).toEqual([]);
    expect(mergeDateEdit(undefined, '2026-10-03')).toEqual([{ isoDate: '2026-10-03', raw: '2026-10-03' }]);
  });
});

  it('wires a picked day through mergeDateEdit (drops time on day change)', () => {
    const onChange = vi.fn();
    render(<FieldEditor parsed={fixture()} onChange={onChange} />);
    fireEvent.change(screen.getByTestId('field-date'), { target: { value: '2026-10-04' } });
    const next = onChange.mock.calls[0]?.[0] as ParsedScreenshot;
    expect(next.dates.value).toEqual([{ isoDate: '2026-10-04', raw: '2026-10-04' }]);
    expect(next.dates.source).toBe('user');
    expect(next.fieldsEdited).toBe(true);
  });

  it('flags missing fields when highlightMissing', () => {
    const empty: ParsedScreenshot = {
      ...fixture(),
      handle: { value: null, confidence: 0, source: 'ocr' },
      text: { value: null, confidence: 0, source: 'ocr' },
      dates: { value: [], confidence: 0, source: 'ocr' },
    };
    render(<FieldEditor parsed={empty} onChange={vi.fn()} highlightMissing />);
    expect(screen.getByTestId('field-handle')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter the @handle shown in the screenshot.')).toBeTruthy();
    expect(screen.getByText('Pick the post date (month/year is enough to start).')).toBeTruthy();
    expect(screen.getByText('Paste or type the post text.')).toBeTruthy();
  });
});
