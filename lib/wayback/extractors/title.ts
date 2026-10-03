// <title> fallback.
import type { CheerioAPI } from 'cheerio';
import { parseOgTitle } from './og';

export interface TitleResult {
  text: string | null;
  displayName?: string;
}

const GENERIC = new Set([
  'x',
  'x.com',
  'twitter',
  'twitter.com',
  'x / home',
  'twitter / home',
  'log in on x',
  'login on x',
]);

export function extractTitle($: CheerioAPI): TitleResult | null {
  const raw = $('title').first().text();
  if (!raw) return null;
  const t = raw.trim();
  if (t === '' || GENERIC.has(t.toLowerCase())) return null;
  const parsed = parseOgTitle(t);
  if (parsed.text) {
    const out: TitleResult = { text: parsed.text };
    if (parsed.displayName) out.displayName = parsed.displayName;
    return out;
  }
  // Bare title that looks like content (avoid nav/login boilerplate).
  if (/log\s*in/i.test(t) && t.length < 60) return null;
  return { text: t };
}
