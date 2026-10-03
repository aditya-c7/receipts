import { describe, it, expect } from 'vitest';
import { parseScreenshot, type OcrInputLine } from '../../lib/ocr/parse';

function line(text: string, i: number, confidence = 0.9): OcrInputLine {
  return { text, confidence, bbox: { x: 0, y: i * 10, w: 100, h: 10 } };
}

const BODY = 'JUST IN: South Korean President Lee Jae-myung strips investigative powers';
const TS = '8:27 AM · Oct 3, 2026 · 36.1K Views';

describe('scored handle selection', () => {
  it('ignores avatar/logo garbage (© misread) before the real handle', () => {
    const p = parseScreenshot([
      line('©ie', 0, 0.95),
      line('Polymarket ✓', 1),
      line('@Polymarket', 2),
      line(BODY, 3),
      line(TS, 4),
    ]);
    expect(p.handle.value).toBe('polymarket');
    expect(p.platform).toBe('x');
    expect(p.displayName.value).toBe('Polymarket ✓');
    // Body starts AFTER the handle line — never swallows it.
    expect(p.text.value ?? '').not.toContain('@Polymarket');
    expect(p.text.value ?? '').toContain('JUST IN');
    expect(p.dates.value?.[0]?.isoDate).toBe('2026-10-03');
  });

  it('ignores Q-misread avatar garbage too', () => {
    const p = parseScreenshot([
      line('Q ie', 0, 0.9),
      line('Polymarket', 1),
      line('@Polymarket', 2),
      line(BODY, 3),
      line(TS, 4),
    ]);
    expect(p.handle.value).toBe('polymarket');
  });

  it('whole-line handle beats an earlier inline mention', () => {
    const p = parseScreenshot([
      line('hi @ab there', 0),
      line('@longhandle', 1),
      line(BODY, 2),
      line(TS, 3),
    ]);
    expect(p.handle.value).toBe('longhandle');
  });

  it('longer whole-line handle beats short garbage', () => {
    const p = parseScreenshot([line('©ie', 0, 0.99), line('@Polymarket', 1), line(BODY, 2), line(TS, 3)]);
    expect(p.handle.value).toBe('polymarket');
  });

  it('skips emails and domain-glued matches', () => {
    const p = parseScreenshot([
      line('Some Person', 0),
      line('contact foo@bar.com today', 1),
      line('Oct 3, 2026', 2),
    ]);
    expect(p.handle.value).toBeNull();
  });

  it('still finds mid-line mentions after "Replying to"', () => {
    const p = parseScreenshot([
      line('Replying to @nasa', 0),
      line('great launch today', 1),
      line('Oct 3, 2026', 2),
    ]);
    expect(p.handle.value).toBe('nasa');
  });
});
