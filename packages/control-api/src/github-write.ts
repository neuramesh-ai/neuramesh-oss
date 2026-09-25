// A REPOSITORY WRITE TOKEN FOR ONE RUN (docs/design/agent-sandbox-2026-09/plan.md §5.3, D6): the
// phase-2 "GitHub App + short-lived tokens for remote agents" of the git-flow doctrine, pulled
// forward because a login-less runner (a warm claim) can never hold a `gh auth login` and still
// has to push a branch and open a pull request.
//
// Custody, in one paragraph. The platform holds the App's private key and mints an installation
// token narrowed at mint time to ONE repository and the write permissions a pull request needs
// (contents, pull_requests) — one hour on GitHub's side, held only by the machine that asked,
// never written to a row, never cached here (the reads' token cache is a read token). A person
// never gets one: the caller is a MACHINE, proven by its own bearer, and the repository is the
// one the room's project connected, so the machine's workspace must be the connector's. The App
// itself must carry the write permissions (a GitHub App setting, re-approved by every
// installation); until it does GitHub answers 422 and the route says which permission is missing.
import type { Env, Hono } from 'hono';
import { hashMachineToken } from './machine-auth';
import { GitHubApiError, githubAppConfigured, installationToken } from './github-app';
import { installationFor, slugOf } from './github-resolve';
import type { Store } from './store';

type Fetch = typeof fetch;

/** what the run may do with the token, no more: push its branch and open its pull request */
export const RUN_WRITE_PERMISSIONS: Record<string, 'read' | 'write'> = { contents: 'write', pull_requests: 'write', metadata: 'read' };

export function githubWriteRoutes<E extends Env>(app: Hono<E>, store: Store, fetchFn: Fetch): void {
  const ann = () => store.announcements;

  app.post('/v1/repo/token', async (c) => {
    // THE CALLER IS A MACHINE, by its own credential: the /v1 gate already resolved an actor from
    // the nmm_ bearer, but the identity that matters here is the machine's, not who it acts as
    const bearer = /^Bearer\s+(nmm_\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    if (!bearer) return c.json({ error: 'a repository write token is minted for a machine, never a person', code: 'MACHINE_ONLY' }, 403);
    if (!store.machineByTokenHash) return c.json({ error: 'fleet not served by this store', code: 'NOT_CONFIGURED' }, 501);
    const machine = await store.machineByTokenHash(hashMachineToken(bearer));
    if (!machine) return c.json({ error: 'unknown machine token', code: 'AUTH_FAILED' }, 401);
    const body = (await c.req.json().catch(() => null)) as { channel?: string } | null;
    const channel = body?.channel;
    if (!channel) return c.json({ error: 'channel is required', code: 'INVALID_INPUT' }, 400);
    if (!githubAppConfigured() || !ann()) return c.json({ error: 'GitHub connecting is not configured on this server', code: 'NOT_CONFIGURED' }, 501);
    const repo = await ann()!.repoForChannel(channel);
    const slug = repo ? slugOf(repo) : null;
    if (!repo || !slug) return c.json({ error: 'this room\'s project has no GitHub repository', code: 'NO_REPO' }, 409);
    // the ACL is the connector row, and the machine must be the connector's workspace's own
    if (repo.workspaceId !== machine.workspace_id) return c.json({ error: 'not this machine\'s workspace', code: 'NOT_PERMITTED' }, 403);
    const conn = await store.connectorWithSecret(repo.workspaceId, 'github', channel);
    if (!conn || conn.status !== 'connected') return c.json({ error: 'GitHub is not connected for this room', code: 'NOT_CONNECTED' }, 409);
    try {
      const inst = await installationFor(ann()!, slug, fetchFn);
      if (!inst) { await store.markConnectorReauth(conn.id); return c.json({ error: `GitHub no longer lets neuramesh reach ${slug}. A person needs to connect GitHub again from Connections.`, code: 'RECONNECT_REQUIRED' }, 409); }
      const name = slug.split('/')[1]!;
      const t = await installationToken(inst.installationId, { fetchFn, scope: { repositories: [name], permissions: RUN_WRITE_PERMISSIONS } });
      console.log(`repo_write_token machine=${machine.id} workspace=${machine.workspace_id} slug=${slug}`);
      return c.json({ slug, token: t.token, expiresAt: t.expiresAt, permissions: RUN_WRITE_PERMISSIONS });
    } catch (e) {
      // 422 is GitHub's "the App does not have that permission": name the fix, not the code
      if (e instanceof GitHubApiError && e.status === 422) {
        return c.json({ error: 'the neuramesh GitHub App does not carry write permissions yet: it needs Contents: write and Pull requests: write, and every installation re-approves the change', code: 'APP_NEEDS_WRITE' }, 409);
      }
      return c.json({ error: e instanceof Error ? e.message : 'GitHub did not answer', code: 'GITHUB_ERROR' }, 502);
    }
  });
}
