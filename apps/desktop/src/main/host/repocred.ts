// A LOGIN-LESS CLOUD MACHINE WRITES THROUGH THE APP (docs/design/repo-writes-2026-09/plan.md, the
// daemon half of D6). A claim runner holds no `gh` login and no git credential, so it could not
// clone a private repository, push a task's branch or open its pull request: every repo-backed task
// on it failed at the submit, and the merge watches skipped it. The server mints a one-hour token
// for the ONE repository the room's project connected (POST /v1/repo/token, a machine bearer only).
//
// Custody: the token lives in this module's memory and reaches only the daemon's OWN git and gh
// processes, through their environment. Never the agent's environment, never a file: an agent that
// runs `git push` itself finds no credential, so code still reaches the base only through the PR.
import type { GhEnv } from './gh';

export type RepoCredResult =
  | { ok: true; env: GhEnv; lane: 'own' | 'app' }
  | { ok: false; code: string; error: string };

/** git reads an extra header from its environment (GIT_CONFIG_COUNT, git 2.31+) and gh reads
 *  GH_TOKEN, so nothing lands in a config file. Appends to any count the process already has. */
export function appCredEnv(token: string, base: NodeJS.ProcessEnv = process.env, identity?: Identity | null): GhEnv {
  const n = Number(base['GIT_CONFIG_COUNT'] ?? 0) || 0;
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return {
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: 'http.https://github.com/.extraheader',
    [`GIT_CONFIG_VALUE_${n}`]: `AUTHORIZATION: basic ${basic}`,
    // a cloud machine has no git identity: the App's bot signs the host's commit
    ...(identity ? { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email, GIT_COMMITTER_NAME: identity.name, GIT_COMMITTER_EMAIL: identity.email } : {}),
  };
}

/** who signs the commit: the App's bot account, as the token route names it */
type Identity = { name: string; email: string };

/** a token with less than this left is minted again: a CI wait (12 min) or a release wait (25 min)
 *  must never outlive the token it started with */
const REMINT_MS = 30 * 60_000;

export function makeRepoCred(o: {
  apiUrl: string;
  /** a cloud machine (runner or member). A laptop always uses its own credentials. */
  cloud: boolean;
  /** the runner: the one machine that merges through the App, so a workspace's machines never race */
  runner: boolean;
  /** the machine's own gh login, which always wins over the App. Asked live, cached a minute. */
  ownLogin: () => Promise<boolean>;
  /** the machine's bearer: the token route accepts nothing else */
  bearer: () => Promise<Record<string, string>>;
  fetchFn?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** how long the runner waits before a merge, so a machine with its own login merges first */
  graceMs?: number;
}) {
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const cache = new Map<string, { token: string; expiresAt: number; identity: Identity | null }>();
  const own = { ok: true, env: {}, lane: 'own' } as const;
  // the login is asked live (it lands while the daemon runs), at most once a minute
  let login = { at: Number.NEGATIVE_INFINITY, yes: false };
  const ownLogin = async (): Promise<boolean> => {
    if (now() - login.at > 60_000) login = { at: now(), yes: await o.ownLogin() };
    return login.yes;
  };

  /** the credential for one repository, asked in the name of one room (the server's ACL) */
  async function forRepo(slug: string, channel: string): Promise<RepoCredResult> {
    if (!slug || !o.cloud || (await ownLogin())) return own;
    const key = slug.toLowerCase();
    const hit = cache.get(key);
    if (hit && hit.expiresAt - now() > REMINT_MS) return { ok: true, env: appCredEnv(hit.token, process.env, hit.identity), lane: 'app' };
    let r: Response;
    try {
      r = await (o.fetchFn ?? fetch)(`${o.apiUrl}/v1/repo/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await o.bearer()) },
        body: JSON.stringify({ channel }),
      });
    } catch (e) {
      return { ok: false, code: 'UNREACHABLE', error: `the API did not answer (${e instanceof Error ? e.message : 'error'})` };
    }
    const j = (await r.json().catch(() => ({}))) as { slug?: string; token?: string; expiresAt?: string; identity?: Identity; code?: string; error?: string };
    if (!r.ok || !j.token) return { ok: false, code: j.code ?? `HTTP_${r.status}`, error: j.error ?? `the token route answered ${r.status}` };
    // the grant is the room's connected repository: a task on another repository gets no token
    if ((j.slug ?? '').toLowerCase() !== key) return { ok: false, code: 'OTHER_REPO', error: `this room's GitHub connection is ${j.slug}, and the task's repository is ${slug}` };
    const identity = j.identity?.name && j.identity.email ? j.identity : null;
    cache.set(key, { token: j.token, expiresAt: Date.parse(j.expiresAt ?? '') || now() + 55 * 60_000, identity });
    return { ok: true, env: appCredEnv(j.token, process.env, identity), lane: 'app' };
  }

  return {
    forRepo,
    /** may this machine run the merge and ship watches at all: its own login, or the runner's App
     *  lane. A machine with neither skips them, as before: a gh-less daemon that tried posted a
     *  failed-merge warning on every sweep. */
    watches: async (): Promise<boolean> => (await ownLogin()) || (o.cloud && o.runner),
    /** the credential for a watch that merges. Through the App only on the runner, and only after
     *  the grace: a machine with its own login acts at once, so it merges first when it is awake,
     *  and the runner then reads the pull request as merged and stays quiet. */
    forMerge: async (slug: string, channel: string): Promise<RepoCredResult> => {
      if (!slug || !o.cloud || (await ownLogin())) return own;
      if (!o.runner) return { ok: false, code: 'NOT_RUNNER', error: 'only the runner merges through the App' };
      await sleep(o.graceMs ?? 60_000);
      return forRepo(slug, channel);
    },
  };
}

export type RepoCred = ReturnType<typeof makeRepoCred>;
