export type ErrorCode =
  | 'ARCHIVE_RATE_LIMITED'
  | 'ARCHIVE_TIMEOUT'
  | 'ARCHIVE_ERROR'
  | 'BAD_INPUT'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class AppError extends Error {
  code: ErrorCode;
  retryAfterMs?: number;
  constructor(code: ErrorCode, message: string, retryAfterMs?: number) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export function toErrorJson(e: unknown): { ok: false; error: { code: ErrorCode; message: string; retryAfterMs?: number } } {
  if (e instanceof AppError) {
    return { ok: false, error: { code: e.code, message: e.message, retryAfterMs: e.retryAfterMs } };
  }
  return { ok: false, error: { code: 'INTERNAL', message: 'Internal error' } };
}
