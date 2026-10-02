// JSON-LD extractor: SocialMediaPosting / Article blocks.
import type { CheerioAPI } from 'cheerio';

export interface LdResult {
  text: string | null;
  displayName?: string;
  handle?: string;
  createdAtIso?: string;
}

function pickText(obj: Record<string, unknown>): string | null {
  const raw = obj['articleBody'] ?? obj['text'];
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  return null;
}

function walk(node: unknown, out: LdResult[]): void {
  if (Array.isArray(node)) {
    for (const v of node) walk(v, out);
    return;
  }
  if (node !== null && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    const types = Array.isArray(t) ? (t as unknown[]) : [t];
    const isPosting = types.some(
      (x) => x === 'SocialMediaPosting' || x === 'Article' || x === 'BlogPosting' || x === 'NewsArticle',
    );
    if (isPosting) {
      const text = pickText(o);
      if (text) {
        const res: LdResult = { text };
        const author = o['author'];
        if (author !== null && typeof author === 'object') {
          const a = author as Record<string, unknown>;
          if (typeof a['name'] === 'string') res.displayName = a['name'] as string;
          if (typeof a['alternateName'] === 'string') {
            res.handle = String(a['alternateName']).replace(/^@/, '');
          }
        } else if (typeof author === 'string') {
          res.displayName = author;
        }
        if (typeof o['datePublished'] === 'string') res.createdAtIso = o['datePublished'] as string;
        else if (typeof o['dateCreated'] === 'string') res.createdAtIso = o['dateCreated'] as string;
        out.push(res);
      }
    }
    for (const v of Object.values(o)) walk(v, out);
  }
}

export function extractLdJson($: CheerioAPI): LdResult | null {
  const found: LdResult[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() ?? '';
    if (!raw.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      walk(parsed, found);
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });
  return found.length > 0 ? (found[0] as LdResult) : null;
}
