import { describe, it, expect } from 'vitest';
import { parseScreenshot, type OcrInputLine } from '../../lib/ocr/parse';

const NOW = new Date(2025, 5, 15, 12, 0, 0);

function L(text: string, y = 0, confidence = 0.9): OcrInputLine {
  return { text, bbox: { x: 0, y, w: 300, h: 14 }, confidence };
}

describe('parseScreenshot', () => {
  it('extracts handle, display name, body, dates, platform', () => {
    const r = parseScreenshot(
      [
        L('NASA', 0),
        L('@nasa', 1),
        L('Mars mission update', 2),
        L('10:30 PM · Dec 5, 2024 · 1.2M Views', 3),
      ],
      { now: NOW },
    );
    expect(r.handle.value).toBe('nasa');
    expect(r.displayName.value).toBe('NASA');
    expect(r.text.value).toBe('Mars mission update');
    expect(r.platform).toBe('x');
    expect(r.language).toBe('eng');
    expect(r.dates.value).toHaveLength(1);
    expect(r.dates.value?.[0]?.isoDate).toBe('2024-12-05');
    expect(r.handle.source).toBe('ocr');
    expect(r.handle.bbox).toBeDefined();
  });

  it('repairs © misread of @', () => {
    const r = parseScreenshot([L('NASA', 0), L('©nasa', 1), L('hello', 2)], { now: NOW });
    expect(r.handle.value).toBe('nasa');
  });

  it('repairs Q/€ misreads and lowercases', () => {
    expect(parseScreenshot([L('Qnasa', 0)], { now: NOW }).handle.value).toBe('nasa');
    expect(parseScreenshot([L('€nasa', 0)], { now: NOW }).handle.value).toBe('nasa');
    expect(parseScreenshot([L('@NASA', 0)], { now: NOW }).handle.value).toBe('nasa');
  });

  it('strips noise lines from the body', () => {
    const r = parseScreenshot(
      [
        L('NASA', 0),
        L('@nasa', 1),
        L('Replying to @other', 2),
        L('Real body here', 3),
        L('Show more', 4),
        L('Translate post', 5),
        L('1.2K Reposts 300 Quotes 5K Likes', 6),
        L('Dec 5, 2024 · 10 Views', 7),
      ],
      { now: NOW },
    );
    expect(r.text.value).toBe('Real body here');
    expect(r.handle.value).toBe('nasa');
    expect(r.platform).toBe('x');
  });

  it('marks platform unknown without handle or signals', () => {
    const r = parseScreenshot([L('Hello', 0), L('world', 1)], { now: NOW });
    expect(r.platform).toBe('unknown');
    expect(r.handle.value).toBeNull();
    expect(r.displayName.value).toBe('Hello');
  });

  it('marks platform unknown when handle exists but no signals', () => {
    const r = parseScreenshot([L('Name', 0), L('@user', 1), L('plain body', 2)], { now: NOW });
    expect(r.handle.value).toBe('user');
    expect(r.platform).toBe('unknown');
  });

  it('joins hyphen-wrapped words and collapses whitespace', () => {
    const r = parseScreenshot(
      [L('Name', 0), L('@user', 1), L('hel-', 2), L('lo   wo  rld', 3), L('Jan 2, 2024 · 5 Views', 4)],
      { now: NOW },
    );
    expect(r.text.value).toBe('hello wo rld');
  });

  it('takes dates from the nearest-bottom matching line', () => {
    const r = parseScreenshot(
      [
        L('Name', 0),
        L('@user', 1),
        L('Since Dec 1, 2023 we fly', 2),
        L('10:30 PM · Dec 5, 2024 · 5 Views', 3),
      ],
      { now: NOW },
    );
    expect(r.dates.value).toHaveLength(1);
    expect(r.dates.value?.[0]?.isoDate).toBe('2024-12-05');
    // Body keeps its own date text (only the timestamp line is excluded).
    expect(r.text.value).toBe('Since Dec 1, 2023 we fly');
  });

  it('yields empty dates + null text when nothing found', () => {
    const r = parseScreenshot([L('@only', 0)], { now: NOW });
    expect(r.dates.value).toEqual([]);
    expect(r.dates.confidence).toBe(0);
    expect(r.text.value).toBeNull();
  });

  it('uses same-line prefix as display name when handle is first', () => {
    const r = parseScreenshot([L('NASA @nasa', 0), L('body', 1)], { now: NOW });
    expect(r.handle.value).toBe('nasa');
    expect(r.displayName.value).toBe('NASA');
  });
});
