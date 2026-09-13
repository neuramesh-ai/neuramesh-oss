// the relay's only outbound calls: control-api answers who a credential belongs to
// (packages/control-api/src/relay.ts). the relay verifies nothing locally and holds no
// keys — both endpoints are gated by RELAY_SECRET, the fleet-secret idiom. a 401 from
// validate-machine means "unknown token" (refuse the socket); any other failure means
// the relay itself can't validate right now (close 1013, let the edge retry).

export interface ValidatorEnv {
  /** control-api origin, e.g. https://api.neuramesh.app */
  apiUrl: string;
  /** RELAY_SECRET — the shared secret control-api checks on /internal/relay/* */
  secret: string;
  timeoutMs?: number;
}

export interface Validators {
  validateMachine(token: string): Promise<{ machineId: string; workspaceId: string } | null>;
  validateClient(clerkToken: string, machineId: string): Promise<{ allowed: boolean; userId?: string }>;
}

export function makeValidators(env: ValidatorEnv): Validators {
  const post = async (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, env.apiUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${env.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.timeoutMs ?? 8000),
    });

  return {
    async validateMachine(token) {
      const res = await post('/internal/relay/validate-machine', { token });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`validate-machine ${res.status}`);
      return (await res.json()) as { machineId: string; workspaceId: string };
    },
    async validateClient(clerkToken, machineId) {
      const res = await post('/internal/relay/validate-client', { clerkToken, machineId });
      // A 400 IS A REFUSAL, NOT AN OUTAGE. control-api validates machineId as a uuid, so a
      // malformed one comes back 400 — and throwing here closed the socket with 1013, whose
      // whole meaning is "the relay could not check right now, retry". The client then tells
      // somebody to try again shortly for a request that will fail identically forever.
      // Found live: an attach with a non-uuid machineId reported "cannot reach NeuraMesh".
      if (res.status === 400) return { allowed: false };
      if (!res.ok) throw new Error(`validate-client ${res.status}`);
      return (await res.json()) as { allowed: boolean; userId?: string };
    },
  };
}
