export class BrainError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 413 | 422 | 429 | 503 = 409) { super(message); }
}
