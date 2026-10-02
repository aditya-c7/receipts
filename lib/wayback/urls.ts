// Canonical X/Twitter status URLs + SSRF allowlist.
import { AppError } from '../errors';

export const ALLOWED_HOSTS = ['web.archive.org', 'archive.org'] as const;
export type AllowedHost = (typeof ALLOWED_HOSTS)[number];

const CANONICAL_RE = /^https?:\/\/(www\.|mobile\.)?(x|twitter)\.com\/[^/]+\/status\/(\d+)\/?(\?.*)?$/;

/** True for canonical https?://(www.|mobile.)?(x|twitter).com/<handle>/status/<id> (+ optional query). */
export function isCanonicalStatusUrl(u: string): boolean {
  return CANONICAL_RE.test(u);
}

/** Extract decimal tweet id string, or null when not canonical. IDs stay strings (exceed 2^53). */
export function extractTweetId(u: string): string | null {
  const m = CANONICAL_RE.exec(u);
  if (!m) return null;
  const id = m[3];
  return id !== undefined ? id : null;
}

/** Wayback replay URL for a capture. */
export function archiveUrl(snapshotTs: string, originalUrl: string): string {
  return `https://web.archive.org/web/${snapshotTs}id_/${originalUrl}`;
}

/**
 * SSRF guard: only allow http(s) URLs whose hostname exactly equals an
 * allowlisted archive host. Rejects userinfo (@evil.com), percent-encoded
 * dots/extra characters in the authority, and unicode-dot lookalikes.
 */
export function assertAllowedUrl(u: string): void {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
  // Reject embedded credentials (user@host tricks).
  if (parsed.username !== '' || parsed.password !== '') {
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
  const host = parsed.hostname.toLowerCase();
  if (!(ALLOWED_HOSTS as readonly string[]).includes(host)) {
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
  // Raw-authority sanity: legit archive hosts never contain '%' or '@';
  // encoded dots (%2e, %252e, %c0%ae) or unicode dots (．。﹒) must not appear.
  const auth = /^https?:\/\/([^/?#]+)/i.exec(u)?.[1] ?? '';
  const hostPort = auth.includes('@') ? auth.slice(auth.lastIndexOf('@') + 1) : auth;
  const rawHost = hostPort.split(':')[0] ?? '';
  if (rawHost.includes('%') || rawHost.includes('@')) {
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
  const lowerRaw = rawHost.toLowerCase();
  if (lowerRaw !== host) {
    // Catches unicode-dot / case / trailing-dot / normalization tricks.
    // Allow a single trailing dot? No — reject to stay strict.
    throw new AppError('BAD_INPUT', 'URL not allowed');
  }
}
