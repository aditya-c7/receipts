// Core types (SPEC §3.6). Tweet IDs are ALWAYS strings — never number (exceed 2^53).
export type Platform = 'x' | 'unknown';

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Field<T> {
  value: T | null;
  confidence: number;
  bbox?: BBox;
  source: 'ocr' | 'user';
}

export interface DateCandidate {
  isoDate: string;
  localMinuteOfDay?: number;
  yearInferred?: boolean;
  dayMonthAmbiguous?: boolean;
  raw: string;
}

export interface ParsedScreenshot {
  platform: Platform;
  displayName: Field<string>;
  handle: Field<string>;
  text: Field<string>;
  dates: Field<DateCandidate[]>;
  language: string;
  ocrMs: number;
  fieldsEdited: boolean;
}

export interface Candidate {
  tweetId: string;
  idTimeMs: number;
  snapshotTs: string;
  originalUrl: string;
  archiveUrl: string;
  statusCode: number;
}

export interface ArchivedPost {
  text: string | null;
  displayName?: string;
  handle?: string;
  createdAtIso?: string;
  extractor: 'ldjson' | 'og' | 'classic' | 'embeddedJson' | 'title' | 'syndication' | 'none';
}

/**
 * Authoritative live-post cross-check (X syndication endpoint, keyless).
 * Only the public tweet ID is sent; screenshot/OCR text never leave.
 * `verifiedBy` is 'archive+x' when archive scoring AND the live post agree,
 * 'x-live' when the archive text was unreadable but the live post verifies.
 */
export interface CrossCheck {
  tweetId: string;
  originalUrl: string;
  status: 'live' | 'unavailable';
  screenName: string | null;
  liveTextSim: number | null;
  authorMatch: boolean | null;
  verified: boolean;
  verifiedBy: 'archive+x' | 'x-live' | null;
}

export type VerdictCode =
  | 'MATCH_STRONG'
  | 'MATCH_LIKELY'
  | 'MATCH_PARTIAL'
  | 'POST_EXISTS_TEXT_UNREADABLE'
  | 'NO_MATCH'
  | 'INSUFFICIENT_INPUT'
  | 'ARCHIVE_UNAVAILABLE'
  | 'UNSUPPORTED_PLATFORM';

export interface Verdict {
  code: VerdictCode;
  score: number | null;
  checks: {
    handle: boolean | null;
    date: boolean | null;
    timeConsistent: boolean | null;
    textSim: number | null;
  };
  best?: { candidate: Candidate; archived: ArchivedPost };
  alternates: Array<{ candidate: Candidate; textSim: number }>;
  crossCheck?: CrossCheck;
  coverage: {
    capturesFound: number;
    capturesCompared: number;
    truncated: boolean;
    from: string;
    to: string;
    /** Set when the server fell back to an OCR-confusable handle variant. */
    repairedHandle?: string;
  };
  diff?: Array<{ op: 'eq' | 'del' | 'ins'; text: string }>;
}
