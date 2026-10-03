// Orchestrator: try extractors in priority order, never return HTML.
import * as cheerio from 'cheerio';
import type { ArchivedPost } from '../types';
import { extractLdJson } from './extractors/ldjson';
import { extractOg } from './extractors/og';
import { extractClassic } from './extractors/classic';
import { extractEmbeddedJson } from './extractors/embeddedJson';
import { extractTitle } from './extractors/title';

function clean(s: string): string | null {
  // cheerio .text() already strips tags + decodes entities; collapse whitespace.
  const t = s.replace(/\s+/g, ' ').trim();
  if (t === '') return null;
  // Defensive: never return anything that still looks like markup.
  if (/<[a-z][\s\S]*>/i.test(t) && /<\/(p|div|span|a)\s*>/i.test(t)) {
    const stripped = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped === '' ? null : stripped;
  }
  if (isJunkArchiveText(t)) return null;
  return t;
}

/**
 * Text-quality gate: archive captures of JS-rendered X pages often yield page
 * chrome ("x.com", login walls, error pages) instead of post text. Scoring
 * such junk produces meaningless similarities (e.g. a "37%" that flips a
 * verdict), so it is rejected here and surfaces as text-unreadable.
 */
export function isJunkArchiveText(t: string): boolean {
  const n = t
    .toLowerCase()
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (n === '') return true;
  const GENERIC = new Set([
    'x',
    'x.com',
    'twitter',
    'twitter.com',
    'home',
    'login',
    'join x',
    'sign in',
    'x / home',
    'log in',
    'log in on x',
    'login on x',
    'sign up',
  ]);
  if (GENERIC.has(n)) return true;
  // Below 10 chars even a perfect read caps at PARTIAL (length guard) while
  // junk risk is highest — treat as unreadable rather than scoring noise.
  if (n.length < 10) return true;
  const JUNK_HINTS = [
    'something went wrong',
    'rate limit exceeded',
    'too many requests',
    'javascript is not available',
    'enable javascript',
    'log in to',
    'sign up to',
    'this post was deleted',
    'post not found',
    'page not found',
    'content is not available',
  ];
  return JUNK_HINTS.some((h) => n.includes(h));
}

/**
 * Extract archived post text (priority: ldjson > og > classic >
 * embeddedJson > title > none). Always plain text, never HTML.
 */
export function extractArchivedPost(html: string): ArchivedPost {
  if (!html || html.trim() === '') return { text: null, extractor: 'none' };
  // Oversized guard: parse a bounded prefix + suffix window to avoid OOM,
  // but keep enough for head meta + body JSON.
  const MAX = 2_000_000;
  const src = html.length > MAX ? html.slice(0, MAX) : html;
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(src);
  } catch {
    return { text: null, extractor: 'none' };
  }

  const ld = extractLdJson($);
  if (ld?.text) {
    const text = clean(ld.text);
    if (text) {
      return { text, displayName: ld.displayName, handle: ld.handle, createdAtIso: ld.createdAtIso, extractor: 'ldjson' };
    }
  }
  const og = extractOg($);
  if (og?.text) {
    const text = clean(og.text);
    if (text) {
      return { text, displayName: og.displayName, handle: og.handle, createdAtIso: og.createdAtIso, extractor: 'og' };
    }
  }
  const cl = extractClassic($);
  if (cl?.text) {
    const text = clean(cl.text);
    if (text) {
      return { text, displayName: cl.displayName, handle: cl.handle, createdAtIso: cl.createdAtIso, extractor: 'classic' };
    }
  }
  const emb = extractEmbeddedJson($, src);
  if (emb?.text) {
    const text = clean(emb.text);
    if (text) {
      return { text, displayName: emb.displayName, handle: emb.handle, createdAtIso: emb.createdAtIso, extractor: 'embeddedJson' };
    }
  }
  const ti = extractTitle($);
  if (ti?.text) {
    const text = clean(ti.text);
    if (text) {
      return { text, displayName: ti.displayName, extractor: 'title' };
    }
  }
  return { text: null, extractor: 'none' };
}
