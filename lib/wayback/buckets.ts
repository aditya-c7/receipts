// Prefix buckets for CDX prefix search. Pure string/BigInt math (no floats).
import { SEARCH_MAX_BUCKETS } from '../config';

function cmpId(a: string, b: string): number {
  const na = a.replace(/^0+(?=\d)/, '');
  const nb = b.replace(/^0+(?=\d)/, '');
  if (na.length !== nb.length) return na.length < nb.length ? -1 : 1;
  if (na === nb) return 0;
  return na < nb ? -1 : 1;
}

function incDecString(s: string): string {
  // s is a numeric string without leading zeros (except "0").
  return (BigInt(s) + 1n).toString();
}

function enumeratePrefixes(lo: string, hi: string): string[] {
  // lo <= hi, same length, both numeric strings of length k.
  const out: string[] = [];
  let cur = lo;
  const limit = 10000; // safety; callers guarantee small ranges
  for (let i = 0; i < limit; i++) {
    out.push(cur);
    if (cur === hi) break;
    cur = incDecString(cur);
    // Preserve zero-padding to length k.
    if (cur.length < lo.length) cur = cur.padStart(lo.length, '0');
  }
  return out;
}

function sameLengthBuckets(minId: string, maxId: string, maxBuckets: number): string[] {
  const n = minId.length;
  for (let k = n; k >= 1; k--) {
    const pMin = minId.slice(0, k);
    const pMax = maxId.slice(0, k);
    const distinct = BigInt(pMax) - BigInt(pMin) + 1n;
    if (distinct <= BigInt(maxBuckets)) {
      return enumeratePrefixes(pMin, pMax);
    }
  }
  // k=1 always yields <= 9 distinct for same-length ids; fallback to single digit range.
  const pMin = minId.slice(0, 1);
  const pMax = maxId.slice(0, 1);
  return enumeratePrefixes(pMin, pMax);
}

function coarsen(buckets: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of buckets) {
    const short = b.length > 1 ? b.slice(0, -1) : b;
    if (!seen.has(short)) {
      seen.add(short);
      out.push(short);
    }
  }
  return out;
}

/**
 * Cover [minId,maxId] with <= maxBuckets decimal prefixes.
 * Chooses the largest prefix length k whose distinct k-digit prefix count
 * fits; when digit lengths differ, splits at 10^n boundaries then merges
 * (coarsening by stripping digits) until the budget fits.
 */
export function idsToPrefixBuckets(
  minId: string,
  maxId: string,
  maxBuckets: number = SEARCH_MAX_BUCKETS,
): string[] {
  if (!/^\d+$/.test(minId) || !/^\d+$/.test(maxId)) {
    throw new Error('tweet ids must be decimal strings');
  }
  let lo = minId.replace(/^0+(?=\d)/, '');
  let hi = maxId.replace(/^0+(?=\d)/, '');
  if (lo === '') lo = '0';
  if (hi === '') hi = '0';
  if (cmpId(lo, hi) > 0) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (lo === hi) return [lo];

  let buckets: string[];
  if (lo.length === hi.length) {
    buckets = sameLengthBuckets(lo, hi, maxBuckets);
  } else {
    // Split at 10^n boundaries: [lo, 99..9(lenLo)], full middle lengths, [10..0(lenHi), hi].
    const chunks: Array<[string, string]> = [];
    chunks.push([lo, '9'.repeat(lo.length)]);
    for (let L = lo.length + 1; L < hi.length; L++) {
      chunks.push([`1${'0'.repeat(L - 1)}`, '9'.repeat(L)]);
    }
    chunks.push([`1${'0'.repeat(hi.length - 1)}`, hi]);
    let combined: string[] = [];
    for (const [cLo, cHi] of chunks) {
      combined.push(...sameLengthBuckets(cLo, cHi, maxBuckets));
    }
    // Dedupe preserving order.
    const seen = new Set<string>();
    combined = combined.filter((b) => {
      if (seen.has(b)) return false;
      seen.add(b);
      return true;
    });
    buckets = combined;
    let guard = 0;
    while (buckets.length > maxBuckets && guard < 24) {
      buckets = coarsen(buckets);
      guard++;
    }
    if (buckets.length === 0) buckets = [lo.slice(0, 1)];
  }
  return buckets;
}
