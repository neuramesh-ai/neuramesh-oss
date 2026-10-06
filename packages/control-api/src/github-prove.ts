// The prove call (docs/design/github-owner-proof-2026-10/plan.md, step 4): POST /v1/github/prove.
// hq's page (or the phone app) sends GitHub's code and the grant's state with the person's own
// session, and only that call writes a proof. The rule: a proof counts only when the signed-in person
// who started the grant sends the code back. So a link that another person, another account or a page
// opens never writes one, and a forged installation_id has nothing to land on.
//
// Every check runs before GitHub is asked, in this order: the state unseals, it is inside its hour, it
// names the caller, its room is in its workspace, and the caller is a human member of that workspace.
// Then the code becomes a user token (with the state's PKCE verifier, so a code redeems only with the
// state of its own link), and the token lists what the person's own account reads. The writes run in
// this order: the attach and the connector row and the resume (github-resolve.ts), the record of the
// connected repository's installation (github-resolve.ts recorded(): the App's own list, so it never
// narrows to one person's view, for this workspace when the record names none, so a rollback finds it,
// and a workspace the record names stays), and the proof row LAST, so a resolve between the writes finds
// the connection or no proof, never a pick for a room this call connects. The token is deleted on
// GitHub at the end, whatever the outcome.
import type { Actor } from '@neuramesh/shared';
import { z } from 'zod';
import { actorInWorkspace } from './credits';
import { installUrl } from './github-app';
import {
  appInstallation, authorizeRefusal, directRepo, dropAuthorization, exchangeCode, githubUser, noAccessRefusal, ownerProofConfigured,
  ProofRefusal, ssoRefusal, STATE_TTL_S, unreachable, unsealProofState, walkInstallations, type ProofCode, type ProvenInstallation,
} from './github-proof';
import { hintFor, resolveConnector, slugOf } from './github-resolve';
import type { Store } from './store';
import type { ProofInput } from './store/github-proofs';

type Fetch = typeof fetch;

export type ProveAnswer =
  | { ok: true; outcome: 'connected'; handle: string; room: string }
  | { ok: true; outcome: 'pick'; repos: string[]; hint: string | null }
  | { ok: true; outcome: 'install'; install: string; slug: string | null }
  | { ok: false; code: ProofCode; error: string; sso?: string; login?: string; slug?: string };

// a page builds the body from its address, so an absent parameter may arrive as null or as ''
const Body = z.object({ code: z.string().nullish(), error: z.string().nullish(), state: z.string().min(1) });
type Grant = { workspace: string; channel: string; actor: string; room: string; state: string };

export async function proveGrant(store: Store, actor: Actor, body: unknown, fetchFn: Fetch): Promise<ProveAnswer> {
  try {
    const grant = await checked(store, actor, body);
    const token = await exchangeCode(grant.code, grant.state, fetchFn);
    let sso = false;
    try {
      return await proven(store, grant, token, fetchFn);
    } catch (e) {
      sso = e instanceof ProofRefusal && e.code === 'SSO';
      throw e;
    } finally {
      // the SSO refusal deletes the whole grant, so the next grant shows GitHub's page and asks again
      await dropAuthorization(token, sso ? 'grant' : 'token', fetchFn);
    }
  } catch (e) {
    const r = e instanceof ProofRefusal ? e : unreachable(e) ? new ProofRefusal('GITHUB_DOWN') : null;
    if (r) return { ok: false, code: r.code, error: r.message, ...r.names };
    throw e;
  }
}

/** the checks that need no GitHub, in the plan's order */
async function checked(store: Store, actor: Actor, body: unknown): Promise<Grant & { code: string }> {
  if (!ownerProofConfigured() || !store.announcements || !store.githubProofs) throw new ProofRefusal('NOT_CONFIGURED');
  const input = Body.safeParse(body);
  const grant = input.success ? unsealProofState(input.data.state) : null;
  if (!input.success || !grant) throw new ProofRefusal('BAD_STATE');
  const s = grant.state;
  if (Date.now() / 1000 - s.iat > STATE_TTL_S) throw new ProofRefusal('EXPIRED');
  if (actor.kind !== 'human' || actor.id !== s.actor) throw new ProofRefusal('OTHER_ACCOUNT');
  const room = s.channel ? await store.channelProject(s.workspace, s.channel).catch(() => null) : null;
  if (!s.channel || !room) throw new ProofRefusal('BAD_STATE');
  if (!(await actorInWorkspace(store, actor, s.workspace))) throw new ProofRefusal('NOT_MEMBER');
  if (input.data.error) throw authorizeRefusal(input.data.error);
  if (!input.data.code) throw new ProofRefusal('BAD_STATE');
  return { workspace: s.workspace, channel: s.channel, actor: actor.id, room: room.slug, state: input.data.state, code: input.data.code };
}

/** what the person's own GitHub account reads, written down, and the room connected when it covers the room */
async function proven(store: Store, grant: Grant, token: string, fetchFn: Fetch): Promise<ProveAnswer> {
  const ann = store.announcements!;
  const user = await githubUser(token, fetchFn);
  const found: ProvenInstallation[] = (await walkInstallations(token, fetchFn)).installations;
  // the room's repository, read now: the state names the room, never the repository
  const repo = await ann.repoForChannel(grant.channel);
  const slug = repo ? slugOf(repo) : null;
  const refusal = slug && !found.some((i) => i.repos.includes(slug.toLowerCase())) ? await unlisted(slug, user.login, token, found, fetchFn) : null;
  const rows: ProofInput[] = found.map((i) => ({ installationId: i.installationId, githubUserId: user.id, githubLogin: user.login, repoIds: i.repoIds, repos: i.repos }));
  const readable = [...new Set(rows.flatMap((r) => r.repos))].sort();
  // a project that holds only a folder: the one proven repository named like the folder attaches, and any other case is the pick
  const namesakes = repo && !slug ? readable.filter((s) => s.split('/')[1] === repo.name.toLowerCase()) : [];
  const ctx = { workspace: grant.workspace, channel: grant.channel, actor: grant.actor };
  const out = await resolveConnector(store, ctx, fetchFn, { proofs: rows, pick: namesakes.length === 1 ? namesakes[0] : null, resume: true, strict: true });
  await store.githubProofs!.replace(grant.workspace, grant.actor, rows);
  if (out.ok) return { ok: true, outcome: 'connected', handle: out.handle, room: grant.room };
  if (refusal) throw refusal;
  if (!slug && readable.length) return { ok: true, outcome: 'pick', repos: readable, hint: hintFor(repo, readable) };
  return { ok: true, outcome: 'install', install: installUrl(grant.state), slug };
}

/** the room's repository is not on the person's lists. When the App reads it, the person's own read says why:
 *  the account reads it (it joins the proof), single sign-on, or no access. When the App reads nothing there,
 *  null: the answer is the install page */
async function unlisted(slug: string, login: string, token: string, found: ProvenInstallation[], fetchFn: Fetch): Promise<ProofRefusal | null> {
  const inst = await appInstallation(slug, fetchFn);
  if (!inst) return null;
  const direct = await directRepo(slug, token, fetchFn);
  if (direct === 'sso') return ssoRefusal(inst.account);
  if (!direct) return noAccessRefusal(login, slug);
  const row = found.find((i) => i.installationId === inst.id);
  if (row) { row.repoIds.push(direct.id); row.repos.push(direct.name); }
  else found.push({ installationId: inst.id, account: inst.account, selection: 'selected', repoIds: [direct.id], repos: [direct.name] });
  return null;
}
