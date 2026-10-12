import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
export const CHATGPT_LOCAL_CREDENTIAL = 'neuramesh-local-chatgpt';
const RECONNECT = 'The ChatGPT sign-in on this machine is unavailable or expired. Sign in again with Codex on this machine, then retry the turn. No API key was used.';

interface SubscriptionCredential { accessToken: string; accountId: string }

/** Parse only the access credential. Never refresh, copy or rewrite the owner's login store. */
export function parseChatGPTCredential(raw: string, now = Date.now()): SubscriptionCredential {
  try {
    const auth = JSON.parse(raw) as { auth_mode?: string; tokens?: { access_token?: unknown; account_id?: unknown } };
    if (auth.auth_mode && auth.auth_mode !== 'chatgpt') throw new Error();
    const accessToken = auth.tokens?.access_token;
    const accountId = auth.tokens?.account_id;
    if (typeof accessToken !== 'string' || !/^[\x21-\x7e]+$/.test(accessToken)
      || typeof accountId !== 'string' || !/^[\w-]+$/.test(accountId)) throw new Error();
    // Expiry is a local hint, not signature verification. OpenAI remains the authority.
    const payload = accessToken.split('.')[1];
    if (payload) {
      let exp: unknown;
      try { exp = (JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown }).exp; } catch { /* opaque access token */ }
      if (typeof exp === 'number' && Number.isFinite(exp) && exp * 1000 <= now) throw new Error();
    }
    return { accessToken, accountId };
  } catch { throw new Error(RECONNECT); }
}

async function localCredential(): Promise<SubscriptionCredential> {
  try { return parseChatGPTCredential(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8')); }
  catch { throw new Error(RECONNECT); }
}

/** Cline receives a non-secret placeholder; only this last transport hop sees the token.
 * It cannot reach control-api, another provider, a redirect, SDK settings or the brain journal.
 * Reload before each request so renewal by Codex works without caching a stale credential.
 */
export function createChatGPTSubscriptionFetch(
  call: typeof fetch = fetch,
  credential: () => Promise<SubscriptionCredential> = localCredential,
): typeof fetch {
  let accountId: string | undefined;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (url.href !== RESPONSES_URL || method.toUpperCase() !== 'POST') {
      throw new Error('ChatGPT coding requests must use the configured OpenAI Responses endpoint.');
    }
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const current = await credential();
    signal?.throwIfAborted();
    if (accountId && accountId !== current.accountId) {
      throw new Error('The ChatGPT account changed during this session. Reopen this thread to use the new account.');
    }
    accountId = current.accountId;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('authorization', `Bearer ${current.accessToken}`);
    headers.set('ChatGPT-Account-Id', current.accountId);
    let response: Response;
    try { response = await call(input, { ...init, headers, redirect: 'error' }); }
    catch {
      // Transport errors can carry request objects/headers; never forward them to the SDK journal.
      signal?.throwIfAborted();
      throw new Error('The ChatGPT subscription request failed. Check your connection and retry the turn.');
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      return Response.json({ error: { message: response.status === 401 ? RECONNECT
        : 'ChatGPT denied access to this model or workspace. Check your ChatGPT access or choose another model. No API key was used.' } }, { status: response.status });
    }
    return response;
  };
}
