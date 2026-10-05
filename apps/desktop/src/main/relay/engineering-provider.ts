import { STARTER_MODEL, providerForModel, type Provider } from '@neuramesh/shared';
import type { EngineeringBrainResolution } from './engineering-brain';
import { readFile } from 'node:fs/promises';
import { keyEnvFor, onCloudMachine } from '../runtime/adapter';
import { decideAuth, type AuthResolution } from '../runtime/authpolicy';
import { hasProviderLogin, hasSubscription } from '../runtime/detect';

export interface EngineeringProviderResolution {
  providerId: string;
  modelId: string;
  apiKey?: string;
  baseUrl?: string;
  /** Used by the platform brain to keep its key and credit meter in the control plane. */
  runtimeFetch?: typeof fetch;
}

export interface EngineeringProviderOptions {
  apiUrl: string;
  /** the machine daemon's credential (nmm_…). The desktop app hosts Code as the signed-in MEMBER
   *  instead (the desktop Code bridge, slice B1): it passes `authHeaders` and an empty token. */
  machineToken: string;
  /** the member's /v1 auth headers — the Clerk bearer in production, x-nm-actor on a dev stack.
   *  When present it is the identity; the endpoints the host calls accept a member as well as a
   *  machine (actorMayReadCredentials · actorInWorkspace). */
  authHeaders?: () => Promise<Record<string, string>>;
  workspaceId: string;
  fetchImpl?: typeof fetch;
}

/** the identity the host speaks to control-api with: the member's headers, else the machine's bearer */
export async function engineeringAuthHeaders(opts: Pick<EngineeringProviderOptions, 'machineToken' | 'authHeaders'>): Promise<Record<string, string>> {
  return opts.authHeaders ? opts.authHeaders() : { authorization: `Bearer ${opts.machineToken}` };
}

const API_PROVIDER: Record<Provider, string> = {
  anthropic: 'anthropic',
  openai: 'openai-native',
  gemini: 'gemini',
};

const SUBSCRIPTION_PROVIDER: Partial<Record<Provider, string>> = {
  anthropic: 'claude-code',
  openai: 'openai-codex-cli',
};

const LABEL: Record<Provider, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

/** what this machine holds for a provider: the agents' own probes (runtime/detect.ts, adapter.ts) */
export interface MachineAuthProbe {
  /** a usable sign-in now */
  subActive(provider: Provider): Promise<boolean>;
  /** a sign-in at all, maybe expired */
  loginPresent(provider: Provider): Promise<boolean>;
  /** the machine's own API key for the provider */
  envKey(provider: Provider): string | null;
}

export const machineAuthProbe: MachineAuthProbe = {
  subActive: hasSubscription,
  loginPresent: hasProviderLogin,
  envKey: (provider) => keyEnvFor(provider).map((k) => process.env[k]).find((v): v is string => !!v) ?? null,
};

/** the refusal a person reads when this machine holds nothing that runs the brain (STE) */
function refusal(provider: Provider, auth: AuthResolution): string {
  const label = LABEL[provider];
  if (provider === 'gemini') return 'Code runs Gemini on an API key only. Add a Gemini API key, or pick another model.';
  if (auth.blocked?.reason === 'expired') return `The ${label} sign-in on this machine expired. Sign in again on this machine, or pick another model.`;
  return `This machine has no ${label} sign-in or API key. Sign in on this machine, add a ${label} API key, or pick another model.`;
}

async function localProviderKey(path: string, provider: Provider): Promise<string | null> {
  const providerId = API_PROVIDER[provider];
  try {
    const body = JSON.parse(await readFile(path, 'utf8')) as { providers?: Record<string, { settings?: { apiKey?: unknown } }> };
    const key = body.providers?.[providerId]?.settings?.apiKey;
    return typeof key === 'string' && key.trim() ? key : null;
  } catch {
    return null;
  }
}

function instructionText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const parts = (value as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return undefined;
  const text = parts.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
    ? (part as { text: string }).text : '').filter(Boolean).join('\n');
  return text || undefined;
}

/** Translate the SDK's Gemini request into the metered Neuramesh starter-brain lane. */
export function createStarterEngineeringFetch(opts: EngineeringProviderOptions): typeof fetch {
  const call = opts.fetchImpl ?? fetch;
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== 'generativelanguage.googleapis.com') return call(input, init);
    const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const request = typeof rawBody === 'string' ? JSON.parse(rawBody) as Record<string, unknown> : {};
    const system = instructionText(request['systemInstruction']);
    const proxy = await call(`${opts.apiUrl}/v1/starter/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(await engineeringAuthHeaders(opts)) },
      body: JSON.stringify({
        workspace: opts.workspaceId,
        contents: request['contents'],
        ...(system ? { system } : {}),
        ...(request['tools'] ? { tools: request['tools'] } : {}),
      }),
      signal: init?.signal,
    });
    if (!proxy.ok) return proxy;
    const text = await proxy.text();
    const streaming = url.pathname.includes(':streamGenerateContent') || url.searchParams.get('alt') === 'sse';
    if (!streaming) return new Response(text, { status: proxy.status, headers: { 'content-type': 'application/json' } });
    return new Response(`data: ${text}\n\n`, { status: proxy.status, headers: { 'content-type': 'text/event-stream' } });
  };
}

export async function resolveEngineeringProvider(
  opts: EngineeringProviderOptions,
  brain: EngineeringBrainResolution,
  env: NodeJS.ProcessEnv = process.env,
  probe: MachineAuthProbe = machineAuthProbe,
): Promise<EngineeringProviderResolution> {
  const explicitKey = env['NM_ENGINEERING_API_KEY'];
  const explicitProvider = env['NM_ENGINEERING_PROVIDER'];
  const explicitModel = env['NM_ENGINEERING_MODEL'];
  const explicitBaseUrl = env['NM_ENGINEERING_BASE_URL'];
  if (explicitKey || explicitProvider || explicitModel || explicitBaseUrl) {
    if (!explicitKey || !explicitProvider || !explicitModel) {
      throw new Error('NM_ENGINEERING_API_KEY, NM_ENGINEERING_PROVIDER, and NM_ENGINEERING_MODEL must be configured together.');
    }
    return { apiKey: explicitKey, providerId: explicitProvider, modelId: explicitModel, ...(explicitBaseUrl ? { baseUrl: explicitBaseUrl } : {}) };
  }

  // The platform brain is not a normal Gemini credential. Its key stays server-side and every
  // call must cross the credit guard, including Engineering tool-loop continuations.
  if (brain.modelId === STARTER_MODEL) {
    return {
      providerId: 'gemini',
      modelId: brain.modelId,
      apiKey: 'neuramesh-starter-proxy',
      runtimeFetch: createStarterEngineeringFetch(opts),
    };
  }

  const credential = providerForModel(brain.modelId);
  const localSettings = env['NM_ENGINEERING_LOCAL_PROVIDER_SETTINGS'];
  if (localSettings) {
    const apiKey = await localProviderKey(localSettings, credential);
    if (apiKey) return { apiKey, providerId: API_PROVIDER[credential], modelId: brain.modelId };
  }
  const params = new URLSearchParams({ workspace: opts.workspaceId, provider: credential });
  if (brain.agentId) params.set('agentId', brain.agentId);
  const call = opts.fetchImpl ?? fetch;
  const response = await call(`${opts.apiUrl}/v1/credentials/resolve?${params}`, {
    headers: await engineeringAuthHeaders(opts),
  });
  if (!response.ok) throw new Error(`Engineering could not resolve the configured ${credential} brain (${response.status}).`);
  const body = (await response.json()) as { token?: string | null; authMode?: string | null; autoFailover?: boolean };
  const stored = body.authMode === 'apikey' || body.authMode === 'subscription' ? body.authMode : null;
  const token = body.token ?? null;
  // model setup lives on the machine (George, 2026-10-04): the agents' own rule (runtime/authpolicy.ts) reads this
  // machine's sign-ins and keys beside the stored preference, so a sign-in made here runs code with no stored row,
  // and a lapsed sign-in never silently bills a key
  const [subActive, loginPresent] = stored === 'apikey' ? [false, false] : await Promise.all([probe.subActive(credential), probe.loginPresent(credential)]);
  const envKey = probe.envKey(credential);
  const auth = decideAuth({ provider: credential, storedAuthMode: stored, storedToken: token, autoFailover: !!body.autoFailover, subActive, loginPresent, envKey, cloudMachine: onCloudMachine(env) });
  if (auth.authMode === 'apikey' && auth.token) return { apiKey: auth.token, providerId: API_PROVIDER[credential], modelId: brain.modelId };
  if (auth.authMode === 'subscription') {
    const providerId = SUBSCRIPTION_PROVIDER[credential];
    if (providerId) return { providerId, modelId: brain.modelId };
    // the coding runtime has no lane for a Google sign-in: a Gemini key on this machine still runs it
    const key = token ?? envKey;
    if (key) return { apiKey: key, providerId: API_PROVIDER[credential], modelId: brain.modelId };
  }
  throw new Error(refusal(credential, auth));
}
