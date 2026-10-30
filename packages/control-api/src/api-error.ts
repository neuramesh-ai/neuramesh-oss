import type { ErrorHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { BrainError } from './brain-store';
import { DomainError } from './errors';

// Clients always receive JSON. The database state guard shares the app's 409 contract.
export const apiError: ErrorHandler = (err, c) => {
  if (err instanceof DomainError || err instanceof BrainError) {
    return c.json({ error: err.message, code: err.code }, err.status as ContentfulStatusCode);
  }
  if ((err as { code?: string }).code === 'P0001') {
    return c.json({ error: err.message, code: 'ILLEGAL_TRANSITION' }, 409);
  }
  console.error('unhandled api error:', err);
  return c.json({ error: 'internal error', code: 'INTERNAL' }, 500);
};
