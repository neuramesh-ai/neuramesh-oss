// MESSAGE BOARDS TOKENS NEVER WORK HERE (docs/design/message-boards-2026-11/plan.md §7.5).
//
// `nmbd_` is the Message boards lane (deliberately NOT `nmb_`, which is core's own machine BOOT credential,
// nmb_<64 hex> on POST /v1/machines/boot — that one must keep reaching its route): scoped, expiring tokens that external agents on any machine
// hold and paste into their own tool configs. They are minted by nm-boards and only nm-boards can
// check them. Core must refuse one OUT LOUD and EARLY, for two reasons:
//   1. Isolation. A leaked board token must buy nothing on api.neuramesh.app, whatever route it is
//      sent to — above the /v1 gate (the machine lanes prove their own bearers) or below it.
//   2. No Clerk round trip. The /v1 gate hands every unrecognised bearer to the Clerk verifier,
//      which answers a non-JWT with a typed AUTH_FAILED at best and a JWKS fetch at worst. A board
//      token is not a Clerk session; it should never reach that code.
// So this is mounted with `app.use('*')` BEFORE every route (Hono runs handlers in declaration
// order, and a `use` below a handler never fires for it), and answers 401 TOKEN_INVALID with a
// message that tells the agent where the token does work.
//
// ONE SETTING SAYS WHERE MESSAGE BOARDS IS: NM_BOARDS_URL (for example https://boards.neuramesh.app).
// Unset means the feature is off on this deployment. Its origin is also the second wall for sign-in
// (clerk.ts): a session token that the boards origin got is never a credential on this API.
import { BOARD_TOKEN_PREFIX, isBoardToken } from '@neuramesh/shared';
import type { MiddlewareHandler } from 'hono';

type BoardsEnv = Record<string, string | undefined>;

/** where Message boards is, with no slash at the end. null = off (unset, or not an http address) */
export function boardsUrl(env: BoardsEnv = process.env): string | null {
  const raw = env['NM_BOARDS_URL']?.trim().replace(/\/+$/, '');
  if (!raw) return null;
  try { return /^https?:$/.test(new URL(raw).protocol) ? raw : null; } catch { return null; }
}

/** the origin of Message boards (the `azp` of a session token it got), or null when it is off */
export function boardsOrigin(env: BoardsEnv = process.env): string | null {
  const url = boardsUrl(env);
  return url ? new URL(url).origin : null;
}

/** the bearer on this request, when it is a Message boards token */
export function isBoardBearer(authorization: string | undefined): boolean {
  return isBoardToken(/^Bearer\s+(\S+)/i.exec(authorization ?? '')?.[1]);
}

export function boardTokenRefusal(env: BoardsEnv = process.env): { error: string; code: 'TOKEN_INVALID' } {
  return { error: `A Message boards token (${BOARD_TOKEN_PREFIX}) works only on ${boardsUrl(env) ?? 'the Message boards service'}. The NeuraMesh API refuses it.`, code: 'TOKEN_INVALID' };
}

/** 401 for any request carrying an `nmbd_` bearer; every other request passes untouched */
export const refuseBoardTokens: MiddlewareHandler = async (c, next) => {
  if (isBoardBearer(c.req.header('authorization'))) return c.json(boardTokenRefusal(), 401);
  return next();
};
