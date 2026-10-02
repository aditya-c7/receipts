// D1 receipt store. Columns mirror worker/db/schema.sql.
// Minimal D1 typings (avoid @cloudflare/workers-types dependency).
import { nanoid } from 'nanoid';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(column?: string): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface ReceiptRow {
  id: string;
  schemaVersion: number;
  verdictCode: string;
  score: number | null;
  handle: string;
  claimedDateIso: string;
  snapshotTs: string;
  originalUrl: string;
  archiveSnippet: string;
  fieldsEdited: number;
  createdAt: number;
}

export interface SaveReceiptInput {
  verdictCode: string;
  score: number | null;
  handle: string;
  claimedDateIso: string;
  snapshotTs: string;
  originalUrl: string;
  archiveSnippet: string;
  fieldsEdited: boolean;
}

const MAX_SNIPPET = 140;

export async function saveReceipt(db: D1Database, input: SaveReceiptInput): Promise<{ id: string }> {
  const id = nanoid(10);
  const snippet = input.archiveSnippet.slice(0, MAX_SNIPPET);
  const createdAt = Date.now();
  await db
    .prepare(
      'INSERT INTO receipts (id, schemaVersion, verdictCode, score, handle, claimedDateIso, snapshotTs, originalUrl, archiveSnippet, fieldsEdited, createdAt) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      input.verdictCode,
      input.score,
      input.handle,
      input.claimedDateIso,
      input.snapshotTs,
      input.originalUrl,
      snippet,
      input.fieldsEdited ? 1 : 0,
      createdAt,
    )
    .run();
  return { id };
}

export async function getReceipt(db: D1Database, id: string): Promise<ReceiptRow | null> {
  const row = await db
    .prepare(
      'SELECT id, schemaVersion, verdictCode, score, handle, claimedDateIso, snapshotTs, originalUrl, archiveSnippet, fieldsEdited, createdAt FROM receipts WHERE id = ?',
    )
    .bind(id)
    .first<ReceiptRow>();
  return row ?? null;
}
