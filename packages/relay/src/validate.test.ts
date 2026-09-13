// the fetch-backed validators against a stub control-api: the wire contract is the
// unit — RELAY_SECRET bearer on every call, body shapes, and the 401-vs-failure split.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { makeValidators } from './validate.js';

interface Seen {
  path: string;
  auth: string | undefined;
  body: unknown;
}

let server: Server | null = null;

function stubApi(status: number, payload: unknown): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      seen.push({ path: req.url ?? '', auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server!.listen(0, () => {
      const { port } = server!.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, seen });
    });
  });
}

afterEach(() => {
  server?.close();
  server = null;
});

describe('makeValidators', () => {
  it('validate-machine sends the secret bearer + token body and returns the identity', async () => {
    const { url, seen } = await stubApi(200, { machineId: 'm1', workspaceId: 'ws1' });
    const v = makeValidators({ apiUrl: url, secret: 's3cret' });
    expect(await v.validateMachine('nmm_abc')).toEqual({ machineId: 'm1', workspaceId: 'ws1' });
    expect(seen).toEqual([
      { path: '/internal/relay/validate-machine', auth: 'Bearer s3cret', body: { token: 'nmm_abc' } },
    ]);
  });

  it('validate-machine maps 401 to null (unknown token), other failures throw', async () => {
    const a = await stubApi(401, { error: 'unknown machine token' });
    expect(await makeValidators({ apiUrl: a.url, secret: 's' }).validateMachine('nmm_x')).toBeNull();
    server?.close();
    const b = await stubApi(500, { error: 'boom' });
    await expect(makeValidators({ apiUrl: b.url, secret: 's' }).validateMachine('nmm_x')).rejects.toThrow(
      'validate-machine 500',
    );
  });

  it('validate-client sends clerkToken + machineId and returns the verdict as-is', async () => {
    const { url, seen } = await stubApi(200, { allowed: true, userId: 'u1' });
    const v = makeValidators({ apiUrl: url, secret: 's3cret' });
    expect(await v.validateClient('clerk-jwt', 'm1')).toEqual({ allowed: true, userId: 'u1' });
    expect(seen).toEqual([
      { path: '/internal/relay/validate-client', auth: 'Bearer s3cret', body: { clerkToken: 'clerk-jwt', machineId: 'm1' } },
    ]);
  });

  it('validate-client throws on a 403 — the relay\'s own secret is wrong, and that must be loud', async () => {
    const { url } = await stubApi(403, { error: 'forbidden' });
    await expect(makeValidators({ apiUrl: url, secret: 'wrong' }).validateClient('t', 'm1')).rejects.toThrow(
      'validate-client 403',
    );
  });
  it('validate-client treats 400 as a REFUSAL, not an outage', async () => {
    // control-api validates machineId as a uuid, so a malformed one is a 400. Throwing here
    // closed the socket with 1013 VALIDATE_UNAVAILABLE, whose meaning is "could not check,
    // retry" — so the pane told somebody to try again shortly for a request that would fail
    // identically forever. Caught against the live deployment, not in a unit test.
    const { url } = await stubApi(400, { error: 'invalid body' });
    const v = makeValidators({ apiUrl: url, secret: 's3cret' });
    expect(await v.validateClient('t', 'not-a-uuid')).toEqual({ allowed: false });
  });
});
