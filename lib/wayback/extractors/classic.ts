// Classic (pre-2016) Twitter HTML: .tweet-text / .js-tweet-text / .permalink-tweet.
import type { CheerioAPI } from 'cheerio';

export interface ClassicResult {
  text: string | null;
  displayName?: string;
  handle?: string;
  createdAtIso?: string;
}

export function extractClassic($: CheerioAPI): ClassicResult | null {
  const sel = $('.tweet-text, .js-tweet-text, .permalink-tweet p, p.js-tweet-text').first();
  let text: string | null = null;
  if (sel.length > 0) {
    const t = sel.text().trim();
    if (t !== '') text = t;
  }
  // data-attribute fallback (some captures keep text in attributes).
  if (text == null) {
    const attr = $('[data-tweet-text]').first().attr('data-tweet-text');
    if (attr != null && attr.trim() !== '') text = attr.trim();
  }
  if (text == null) return null;
  const out: ClassicResult = { text };
  const screenName = $('[data-screen-name]').first().attr('data-screen-name');
  const dispName = $('[data-name]').first().attr('data-name');
  if (screenName != null && screenName.trim() !== '') out.handle = screenName.trim().replace(/^@/, '');
  if (dispName != null && dispName.trim() !== '') out.displayName = dispName.trim();
  const time = $('time[datetime]').first().attr('datetime') ?? $('[data-time]').first().attr('data-time');
  if (time != null && time.trim() !== '') {
    // data-time is epoch seconds in classic markup.
    if (/^\d+$/.test(time.trim())) {
      const ms = Number(time.trim()) * 1000;
      if (Number.isFinite(ms)) out.createdAtIso = new Date(ms).toISOString();
    } else {
      out.createdAtIso = time.trim();
    }
  }
  return out;
}
