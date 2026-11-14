// MESSAGE BOARDS FOR THE AGENTS (docs/design/message-boards-2026-11/plan.md §7.6): the ONE
// implementation behind every registry that offers the family (the orchestrator's, the conversation's,
// the worker bus with its Claude clones, and a coding thread), as host/reporead.ts is for the
// repository reads. The registries only log and forward.
//
// THE CREDENTIAL. A person gives an agent access to a board. This machine then asks the core API,
// with its machine token, for that agent's managed credential
// (GET /v1/machines/agents/:agentId/board-credentials) and calls the Message boards service with it.
// The credential lives in this process's memory and nowhere else: no file, no environment variable,
// no command line, no log line and no tool result holds it. A machine with no machine token has no
// access (a laptop: the desktop app speaks to the core API as its signed-in person, and only a cloud
// machine holds an nmm_ token), so its agents get no Message boards tool.
//
// WHAT COMES BACK IS UNTRUSTED. Other agents and people wrote the messages. The service wraps them in
// an envelope that says so, and a read returns that envelope exactly as the service gave it. Nothing
// here follows a message, rewrites one or removes the envelope. A long answer ends after a whole tag.
import { randomUUID } from 'node:crypto';
import { isBoardToken } from '@neuramesh/shared';
import { machineBearer } from '../apiauth';

export const BOARD_MESSAGE_KINDS = ['note', 'summary', 'plan', 'handoff', 'decision', 'action_request'] as const;
export type BoardMessageKind = (typeof BOARD_MESSAGE_KINDS)[number];

/** what the core API answers. Typed here and not imported: this app is public, the boards packages are private */
export interface BoardCredential {
  token: string;
  expiresAt: string;
  /** the REST base of the service, for example https://boards.neuramesh.app/api/v1 */
  apiUrl: string;
  boards: Array<{ boardSlug: string; workspaceSlug: string; perm: string }>;
}
export type BoardAccess = { ok: true; credential: BoardCredential } | { ok: false; reason: string };

/** the four operations, bound to one agent. Each answers text for the model and none throws */
export interface MessageBoardTools {
  list(): Promise<string>;
  catchUp(i: { board: string; topic: string; since?: string; limit?: number }): Promise<string>;
  send(i: { board: string; topic: string; kind: BoardMessageKind; title?: string; body: string; tags?: string[] }): Promise<string>;
  takeHandoff(i: { messageId: string; note?: string }): Promise<string>;
}

export interface MessageBoards {
  /** the agent's credential, from memory while it is fresh. Never throws */
  boardCredential(agentId: string): Promise<BoardAccess>;
  /** the tools of an agent with access, or null: a registry then offers no Message boards tool */
  toolsFor(agentId: string | null | undefined): Promise<MessageBoardTools | null>;
}

export interface MessageBoardDeps {
  /** the core API of this machine, read at each call */
  apiUrl: () => string;
  /** this machine's token (nmm_), read at each call because a Cloud Run machine renews it. null = none */
  machineToken: () => string | null;
  fetch?: typeof fetch;
  now?: () => number;
  /** the daemon's log, for a credential read that failed. No line holds a token */
  log?: (line: string) => void;
}

/** a credential is asked again one hour before it expires */
export const REFRESH_BEFORE_MS = 60 * 60_000;
/** "this agent has no access" is remembered this long */
export const NO_ACCESS_TTL_MS = 5 * 60_000;
/** a failure is remembered this long, so a core API that is down costs one wait and not one for each turn */
export const FAILURE_TTL_MS = 30_000;
export const BOARD_TEXT_CAP = 60_000;
const CREDENTIAL_TIMEOUT_MS = 8_000;
const CALL_TIMEOUT_MS = 15_000;

export const NO_ACCESS = 'This agent has no access to a message board.';
const notNow = (why: string): string => `Message boards is not available now. ${why}`;
const NO_ANSWER = 'The Message boards service did not answer. Try again later.';
const NOT_AN_ENVELOPE = 'The Message boards service answered in an unknown format. This tool did not read the answer.';
const REFUSED = 'The Message boards service refused the credential of this agent.';
const BAD_REF = 'The board or the topic is not valid. Use the ref values from message_board_list: workspace/board for the board, and the last part of a topic ref for the topic.';
const BAD_ID = 'The message ID is not valid. Use the id of a handoff message from message_board_catch_up.';
const NO_BODY = 'The message has no text. Put the text in body.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** the token goes over https only, or to this machine itself (a dev stack) */
function restBase(raw: unknown): string | null {
  if (!str(raw)) return null;
  try {
    const u = new URL(raw);
    const here = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && here)) return null;
    return u.username || u.password || u.search || u.hash ? null : u.href.replace(/\/+$/, '');
  } catch { return null; }
}

function credentialOf(v: unknown, now: number): BoardCredential | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const apiUrl = restBase(o['apiUrl']);
  if (!str(o['token']) || !isBoardToken(o['token']) || !apiUrl || !str(o['expiresAt']) || !Array.isArray(o['boards'])) return null;
  const expires = Date.parse(o['expiresAt']);
  if (Number.isNaN(expires) || expires <= now) return null;
  const boards: BoardCredential['boards'] = [];
  for (const b of o['boards'] as Array<Record<string, unknown> | null>) {
    if (!b || !str(b['boardSlug']) || !str(b['workspaceSlug']) || !str(b['perm'])) return null;
    boards.push({ boardSlug: b['boardSlug'], workspaceSlug: b['workspaceSlug'], perm: b['perm'] });
  }
  return { token: o['token'], expiresAt: o['expiresAt'], apiUrl, boards };
}

/** text for the model or a log, with this agent's own token taken out wherever it stands */
const clean = (text: string, token: string): string => (text.includes(token) ? text.split(token).join('[token removed]') : text);

/** A long envelope ends after its last whole tag under the cap. A closer holds the nonce of the
 *  answer, which no message can write, so the cut can never stand inside untrusted text. */
export function cutEnvelope(text: string, cap = BOARD_TEXT_CAP): string {
  if (text.length <= cap) return text;
  const nonce = /nonce="([0-9A-Za-z_-]{4,64})"/.exec(text.slice(0, 2_000))?.[1];
  let end = -1;
  if (nonce) {
    const closer = new RegExp(`</[a-z_]+ nonce="${nonce}">`, 'g');
    for (let m = closer.exec(text); m && m.index + m[0].length <= cap; m = closer.exec(text)) end = m.index + m[0].length;
  }
  if (end < 0) return `The answer of the Message boards service is too large to read: ${text.length} characters. Use a smaller limit or a shorter period.`;
  return `${text.slice(0, end)}\n\nThe answer of the Message boards service ends here: it has ${text.length} characters, and this tool returns ${cap} at most. Use a smaller limit or a shorter period to read the rest.`;
}

type Call = { method: 'GET' | 'POST'; path: string; body?: unknown; headers?: Record<string, string> };

/** `workspace/board` and a topic → the REST path. `board` alone is enough when the credential puts
 *  that board (or every board) in one workspace. The topic is its slug, `#slug`, or the whole ref
 *  from the list. Each part must be a slug, so no part can leave the path */
function topicPath(c: BoardCredential, board: string, topic: string): string | null {
  const parts = board.trim().replace(/^\/+|\/+$/g, '').split('/');
  const named = c.boards.filter((b) => b.boardSlug === parts[0]);
  const workspaces = [...new Set((named.length ? named : c.boards).map((b) => b.workspaceSlug))];
  const [ws, slug] = parts.length === 2 ? parts : parts.length === 1 && workspaces.length === 1 ? [workspaces[0], parts[0]] : [];
  const ref = topic.trim().replace(/^#/, '').split('/');
  const t = ref.length === 1 || ref.length === 3 ? ref.at(-1) : undefined;
  return ws && slug && t && [ws, slug, ...ref].every((p) => SLUG.test(p)) ? `/w/${ws}/${slug}/${t}` : null;
}

async function refusalOf(res: Response, token: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return str(body?.error) ? clean(body.error.trim().slice(0, 500), token) : `The Message boards service answered ${res.status}.`;
}

async function envelopeOf(res: Response, token: string): Promise<string> {
  if (!/^text\/plain\b/i.test(res.headers.get('content-type') ?? '')) return NOT_AN_ENVELOPE;
  return clean(cutEnvelope(await res.text()), token);
}

async function sentOf(res: Response): Promise<string> {
  const m = (await res.json().catch(() => null)) as { id?: unknown; redactions?: unknown } | null;
  if (!m || !str(m.id) || !UUID.test(m.id)) return 'The Message boards service accepted the message. This tool could not read the ID of the message.';
  const n = typeof m.redactions === 'number' && m.redactions > 0 ? Math.floor(m.redactions) : 0;
  return `The message is on the board. Its ID is ${m.id}.${n ? ` The service removed ${n} secret${n === 1 ? '' : 's'} from the text.` : ''}`;
}

type Answer = (res: Response, token: string) => Promise<string>;
/** one call to the service as one agent: `build` gets the credential and answers the call, or a sentence that refuses it */
type CallAs = (build: (c: BoardCredential) => Call | string, answer: Answer) => Promise<string>;

const toolsOver = (call: CallAs): MessageBoardTools => ({
  list: () => call(() => ({ method: 'GET', path: '/boards?format=envelope' }), envelopeOf),
  catchUp: (i) => call((c) => {
    const at = topicPath(c, i.board, i.topic);
    const q = new URLSearchParams({ format: 'envelope', ...(i.since ? { since: i.since } : {}), ...(i.limit ? { limit: String(i.limit) } : {}) });
    return at ? { method: 'GET', path: `${at}/catch-up?${q.toString()}` } : BAD_REF;
  }, envelopeOf),
  send: (i) => {
    // one key for the call and its one retry: the service then makes one message
    const key = `nm-${randomUUID()}`;
    return call((c) => {
      const at = topicPath(c, i.board, i.topic);
      if (!i.body.trim()) return NO_BODY;
      return at ? { method: 'POST', path: `${at}/messages`, headers: { 'idempotency-key': key }, body: { kind: i.kind, title: i.title ?? '', bodyMd: i.body, tags: i.tags ?? [] } } : BAD_REF;
    }, sentOf);
  },
  takeHandoff: (i) => call(() => (UUID.test(i.messageId.trim())
    ? { method: 'POST', path: `/messages/${i.messageId.trim()}/ack?format=envelope`, body: i.note ? { note: i.note } : {} }
    : BAD_ID), envelopeOf),
});

export function makeMessageBoards(deps: MessageBoardDeps): MessageBoards {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { access: BoardAccess; until: number }>();
  const flights = new Map<string, Promise<BoardAccess>>();

  const failed = (agentId: string, what: string, why: string): { access: BoardAccess; until: number } => {
    deps.log?.(`message_boards credential agent=${agentId} ${what}`);
    return { access: { ok: false, reason: notNow(why) }, until: now() + FAILURE_TTL_MS };
  };

  async function read(agentId: string, machineToken: string): Promise<{ access: BoardAccess; until: number }> {
    let res: Response;
    try {
      res = await doFetch(`${deps.apiUrl().replace(/\/+$/, '')}/v1/machines/agents/${agentId}/board-credentials`, {
        headers: { authorization: `Bearer ${machineToken}` }, signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
      });
    } catch (e) {
      return failed(agentId, `no_answer ${e instanceof Error ? e.name : 'error'}`, 'The core API did not answer.');
    }
    // 204: no grant, or the feature is off. 404: the agent is not on this machine's workspace, or it is retired
    if (res.status === 204 || res.status === 404) return { access: { ok: false, reason: NO_ACCESS }, until: now() + NO_ACCESS_TTL_MS };
    if (!res.ok) return failed(agentId, `status=${res.status}`, `The core API answered ${res.status}.`);
    const at = now();
    const credential = credentialOf(await res.json().catch(() => null), at);
    if (!credential) return failed(agentId, 'shape_invalid', 'The core API did not answer with a credential.');
    // kept until one hour before it expires. a credential with less than that left is kept one minute,
    // so two calls in a row never ask for two tokens
    const expires = Date.parse(credential.expiresAt);
    return { access: { ok: true, credential }, until: Math.max(expires - REFRESH_BEFORE_MS, Math.min(expires, at + 60_000)) };
  }

  async function boardCredential(agentId: string): Promise<BoardAccess> {
    const machineToken = deps.machineToken();
    if (!machineToken) return { ok: false, reason: notNow('This machine has no machine token.') };
    if (!UUID.test(agentId)) return { ok: false, reason: NO_ACCESS };
    const hit = cache.get(agentId);
    if (hit && now() < hit.until) return hit.access;
    // one read for each agent at a time: the service keeps one credential for each agent and machine,
    // so a second read would end the token that the first one got
    let flight = flights.get(agentId);
    if (!flight) {
      flight = read(agentId, machineToken)
        .catch(() => failed(agentId, 'threw', 'The core API did not answer.'))
        .then((entry) => { cache.set(agentId, entry); return entry.access; })
        .finally(() => flights.delete(agentId));
      flights.set(agentId, flight);
    }
    return flight;
  }

  async function call(agentId: string, build: (c: BoardCredential) => Call | string, answer: Answer, again = true): Promise<string> {
    const access = await boardCredential(agentId);
    if (!access.ok) return access.reason;
    const c = access.credential;
    const req = build(c);
    if (typeof req === 'string') return req;
    let res: Response;
    try {
      res = await doFetch(`${c.apiUrl}${req.path}`, {
        method: req.method, redirect: 'error', signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        headers: { authorization: `Bearer ${c.token}`, 'x-nm-client': 'neuramesh', ...(req.body === undefined ? {} : { 'content-type': 'application/json' }), ...req.headers },
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
      });
    } catch {
      return NO_ANSWER;
    }
    if (res.status === 401) {
      // the service ended this token (it expired, or a person removed a grant): ask for the credential
      // again, once. an agent with no grant left then reads NO_ACCESS
      if (cache.get(agentId)?.access === access) cache.delete(agentId);
      return again ? call(agentId, build, answer, false) : REFUSED;
    }
    // an answer that breaks while it is read is "no answer" too: no call throws into a turn
    return (res.ok ? answer(res, c.token) : refusalOf(res, c.token)).catch(() => NO_ANSWER);
  }

  return {
    boardCredential,
    toolsFor: async (agentId) => (agentId && (await boardCredential(agentId)).ok ? toolsOver((build, answer) => call(agentId, build, answer)) : null),
  };
}

// THE DAEMON'S OWN. The machine token and the address of its API come from one environment
// (NM_MACHINE_TOKEN, NM_API_URL: the default is machined-config.ts readConfig's), so the token goes to
// that API and to no other address.
const daemon = makeMessageBoards({
  apiUrl: () => process.env['NM_API_URL'] ?? 'https://api.neuramesh.app',
  machineToken: machineBearer,
  log: (line) => console.warn(line),
});

/** the Message boards tools of this agent on this machine, or null when it has no access now.
 *  A registry asks before it builds, so a turn of an agent with no grant has no board tool at all */
export const messageBoardsFor = (agentId: string | null | undefined): Promise<MessageBoardTools | null> => daemon.toolsFor(agentId);
