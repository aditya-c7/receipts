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
  return t;
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
