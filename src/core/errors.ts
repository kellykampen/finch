export type FinchErrorCode =
  | "INTERNAL_ERROR"
  | "USAGE_ERROR"
  | "AUTH_ERROR"
  | "CLIENT_ERROR"
  | "RATE_LIMITED"
  | "NETWORK_ERROR";

export class FinchError extends Error {
  readonly code: FinchErrorCode;
  readonly detail: unknown;

  constructor(code: FinchErrorCode, message: string, detail: unknown = null) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const EXIT_CODES: Record<FinchErrorCode, number> = {
  INTERNAL_ERROR: 1,
  USAGE_ERROR: 2,
  AUTH_ERROR: 3,
  CLIENT_ERROR: 4,
  RATE_LIMITED: 5,
  NETWORK_ERROR: 6,
};

export function exitCodeForError(code: FinchErrorCode): number {
  return EXIT_CODES[code];
}
