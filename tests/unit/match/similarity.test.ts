import { describe, it, expect } from 'vitest';
import { textSimilarity } from '../../../lib/match/similarity';
import { scorePair } from '../../../lib/match/score';
import { wordDiff } from '../../../lib/match/diff';

const LONG_A =
  'The city council approved the new downtown transit plan after months of public debate and revisions';
const LONG_B = LONG_A;

describe('match matrix', () => {
  it('identical >= 0.97', () => {
    expect(textSimilarity(LONG_A, LONG_B).score).toBeGreaterThanOrEqual(0.97);
  });

  it('ocr-noisy >= 0.90 via folded', () => {
    const noisy = LONG_A.replace(/o/g, '0').replace(/m/g, 'rn');
    const s = textSimilarity(LONG_A, noisy).score;
    expect(s).toBeGreaterThanOrEqual(0.9);
  });

  it('numeral-change capped < 0.90 flagged', () => {
    const a = 'The Mars rover traveled 240 kilometers across the dusty plains and collected many rock samples';
    const b = 'The Mars rover traveled 241 kilometers across the dusty plains and collected many rock samples';
    const r = textSimilarity(a, b);
    expect(r.score).toBeLessThan(0.9);
    expect(r.detail.numberMismatch).toBe(true);
  });

  it('handle-off capped 0.60', () => {
    const r = scorePair(LONG_A, LONG_A, { handleOK: false, dateOK: true, timeConsistent: true });
    expect(r.score).toBeLessThanOrEqual(0.6);
    expect(r.cappedBy).toContain('context');
  });

  it('short <= 0.80', () => {
    const r = textSimilarity('hello world', 'hello world');
    expect(r.score).toBeLessThanOrEqual(0.8);
  });

  it('different < 0.55', () => {
    const a = 'The city council approved the new downtown transit plan after months of public debate';
    const b = 'Quantum mechanics describes subatomic particle interactions with precise mathematics';
    expect(textSimilarity(a, b).score).toBeLessThan(0.55);
  });

  it('truncated >= 0.90 via partial', () => {
    const full = 'The city council approved the new downtown transit plan after months of public debate and revisions';
    const trunc = 'The city council approved the new downtown transit plan after months';
    expect(textSimilarity(full, trunc).score).toBeGreaterThanOrEqual(0.9);
  });

  it('emoji/url ignored', () => {
    const a = `${LONG_A} https://t.co/abc123`;
    const b = `${LONG_A} 😀🎉`;
    expect(textSimilarity(a, b).score).toBeGreaterThanOrEqual(0.97);
  });

  it('wordDiff neutral labels', () => {
    const d = wordDiff('hello brave world', 'hello world');
    expect(d.some((p) => p.op === 'del' || p.op === 'ins')).toBe(true);
    expect(d.every((p) => ['eq', 'del', 'ins'].includes(p.op))).toBe(true);
  });
});
