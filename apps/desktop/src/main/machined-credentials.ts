import { signDevToken } from './token';
import type { MachinedConfig } from './machined-config';

export interface MachineSyncCredentials {
  endpoint: string;
  token: string;
  expiresAt?: Date;
}

const isLoopback = (url: string): boolean => {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
};

/** Resolve machined's PowerSync credential. Cloud always exchanges the machine bearer for the
 * short-lived RS256 token. The local harness can opt into the committed dev-stack HS256 key, but
 * only for a loopback PowerSync endpoint; setting the flag against a cloud URL fails closed. */
export async function machineSyncCredentials(
  cfg: MachinedConfig,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<MachineSyncCredentials> {
  if (env['NM_MACHINED_DEV_SYNC'] === '1') {
    if (!isLoopback(cfg.powersyncUrl)) throw new Error('NM_MACHINED_DEV_SYNC only supports a loopback PowerSync endpoint');
    return { endpoint: cfg.powersyncUrl, token: signDevToken(cfg.ownerUserId) };
  }
  const res = await fetchImpl(`${cfg.apiUrl}/v1/machines/sync-token`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.machineToken}` },
  });
  if (!res.ok) throw new Error(`sync-token exchange failed: ${res.status} ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { token: string; expiresInSeconds: number };
  const expiresAt = new Date(Date.now() + (body.expiresInSeconds - 60) * 1000);
  return { endpoint: cfg.powersyncUrl, token: body.token, expiresAt };
}
