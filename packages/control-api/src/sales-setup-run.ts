// SALES SETUP, THE SERVER'S HALF (docs/design/sales-onboarding-2026-11/plan.md SO1 to SO17, approved 2026-11-26).
//
// The cards are the server's (SO3): `startSalesSetup` opens the session in the `sales` room with pike's first line and
// the first step card, and `advanceSalesSetup`, which runs after every write that can move a step, posts the next
// step's card once, or the finish when every step is done or skipped and 3 leads are reachable. A card is a marker
// message as pike that wakes no agent. pike's own work lands in the session through its tools, and a button that asks
// pike for work sends the person's own message, so pike answers a person, never a marker.
import {
  SALES_ROOM_SLUG, SALES_SETUP_FLOW, createEvent, formatAddress, reachableLeads, salesSetupState, setupMarker,
  type Actor, type CompanyProfile, type SalesSetupFacts, type SalesSetupState, type SalesSetupView, type SetupRunRow,
} from '@neuramesh/shared';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { gmailLinked } from './private';
import type { Store } from './store';
import { salesOf } from './store/sales';
import { setupRunsOf, type SetupRunStore } from './store/setup-runs';

const FLOW = SALES_SETUP_FLOW;
// the in-memory store's run rows read the deals it holds, each naming its run
const runsOf = (store: Store): SetupRunStore => setupRunsOf(store, async () => (salesOf(store) as unknown as { dealRows?: Array<{ setup_run?: string | null }> }).dealRows ?? []);

/** the room and the agent of the run: the `sales` room of the default project, and its sales agent */
async function roomAndAgent(store: Store, workspace: string): Promise<{ channel: string; agent: string } | null> {
  const sql = sqlOf(store);
  if (!sql) {
    const mem = store as unknown as { channels?: Array<{ id: string; workspaceId?: string; workspace_id?: string; slug: string }>; agents?: Array<{ id: string; role: string; workspaceId?: string; workspace_id?: string; retiredAt?: string | null }> };
    const ch = mem.channels?.find((c) => (c.workspaceId ?? c.workspace_id) === workspace && c.slug === SALES_ROOM_SLUG);
    const ag = mem.agents?.find((a) => (a.workspaceId ?? a.workspace_id) === workspace && a.role === 'sales' && !a.retiredAt);
    return ch && ag ? { channel: ch.id, agent: ag.id } : null;
  }
  const [r] = await sql`select c.id as channel, a.id as agent from channels c join projects p on p.id = c.project_id and p.is_default
      join agent_channels ac on ac.channel_id = c.id join agents a on a.id = ac.agent_id and a.role = 'sales' and a.retired_at is null
    where c.workspace_id = ${workspace}::uuid and c.slug = ${SALES_ROOM_SLUG} order by a.created_at limit 1`;
  return r ? { channel: String(r['channel']), agent: String(r['agent']) } : null;
}

/** posts one message into the run's session as the sales agent. A new thread id births the session */
async function postAs(store: Store, workspace: string, channel: string, thread: string, agent: string, body: string): Promise<void> {
  const author = { kind: 'agent' as const, id: agent };
  await store.postMessage(
    { id: crypto.randomUUID(), workspace, channel, taskId: null, threadId: thread, author, body, createdAt: new Date().toISOString(), threadMode: 'chat' },
    createEvent({ type: 'message.posted', source: formatAddress(author), target: `channel/${channel}`, workspace, payload: { preview: body.slice(0, 120) } }),
  );
}

/** the facts of a run, each from its real home. The Gmail step reads the mail link of the person who started the run,
 *  so the server's steps and every viewer's cards agree */
async function factsOf(store: Store, run: SetupRunRow): Promise<{ facts: SalesSetupFacts; profile: CompanyProfile | null }> {
  const runs = runsOf(store);
  const sales = salesOf(store);
  const [profile, own, contacts, deals, link] = await Promise.all([
    runs.profile(run.workspace_id), runs.facts(run), sales.contacts(run.workspace_id), sales.deals(run.workspace_id),
    gmailLinked(store, run.workspace_id, run.started_by),
  ]);
  return {
    profile,
    facts: {
      offer: !!profile?.offer?.sells, customer: !!profile?.customer && Object.values(profile.customer).some((v) => v.length > 0),
      gmail: link, found: own.found, added: own.added, noted: own.noted, reachable: reachableLeads(deals, contacts),
    },
  };
}


/** GET /v1/sales/setup: the run, where it stands for this person, and the answers on the company profile */
export async function salesSetupView(store: Store, workspace: string): Promise<SalesSetupView> {
  const run = await runsOf(store).get(workspace, FLOW.id);
  if (!run) {
    const profile = await runsOf(store).profile(workspace);
    return { flow: FLOW, run: null, state: null, profile: { website: profile?.website ?? '', offer: profile?.offer ?? null, customer: profile?.customer ?? null } };
  }
  const { facts, profile } = await factsOf(store, run);
  return { flow: FLOW, run, state: salesSetupState(run, facts), profile: { website: profile?.website ?? '', offer: profile?.offer ?? null, customer: profile?.customer ?? null } };
}

/**
 * setup.start: one run for each workspace. A workspace with 3 reachable leads already needs no setup, so it gets none.
 * The session is born with pike's first line and the first step card in one message.
 */
export async function startSalesSetup(store: Store, actor: Actor, workspace: string): Promise<{ run: SetupRunRow | null; created: boolean }> {
  const runs = runsOf(store);
  const have = await runs.get(workspace, FLOW.id);
  if (have) return { run: have, created: false };
  const sales = salesOf(store);
  const [contacts, deals] = await Promise.all([sales.contacts(workspace), sales.deals(workspace)]);
  if (reachableLeads(deals, contacts) >= FLOW.bar) return { run: null, created: false };
  const where = await roomAndAgent(store, workspace);
  if (!where) throw new DomainError('NOT_FOUND', 'Sales has no sales agent yet. Open Sales again in a moment');
  const { run, created } = await runs.create({ workspace, flow: FLOW.id, channel: where.channel, startedBy: actor.id });
  if (!created) return { run, created };
  const thread = crypto.randomUUID();
  await postAs(store, workspace, where.channel, thread, where.agent, `${FLOW.intro}\n\n${setupMarker(FLOW.id, FLOW.steps[0]!.id)}`);
  await runs.setThread(run.id, thread, FLOW.title);
  await runs.moveStep(run.id, FLOW.steps[0]!.id);
  return { run: { ...run, thread_id: thread, step: FLOW.steps[0]!.id }, created: true };
}

/** after a write that can move a step: post the next step's card once, or the finish once */
export async function advanceSalesSetup(store: Store, workspace: string): Promise<SalesSetupState | null> {
  const runs = runsOf(store);
  const run = await runs.get(workspace, FLOW.id);
  if (!run || !run.thread_id || run.completed_at || run.ended_at) return null;
  const { facts } = await factsOf(store, run);
  const state = salesSetupState(run, facts);
  const where = await roomAndAgent(store, workspace);
  if (state.complete) {
    if (await runs.finish(run.id, 'completed') && where) {
      await postAs(store, workspace, run.channel_id, run.thread_id, where.agent, `Sales is ready. ${state.reachable} leads are in your pipeline. ${setupMarker(FLOW.id, 'done')}`);
    }
    return { ...state, complete: true, now: null };
  }
  if (state.now && where && await runs.moveStep(run.id, state.now)) {
    const back = state.now === 'find' && state.steps.every((s) => s.id === 'find' || s.status !== 'next');
    const words = back ? `You have ${state.reachable} ${state.reachable === 1 ? 'lead' : 'leads'} that a note can reach. Setup ends when you have ${FLOW.bar}. ` : '';
    await postAs(store, workspace, run.channel_id, run.thread_id, where.agent, `${words}${setupMarker(FLOW.id, state.now)}`);
  }
  return state;
}

/** setup.skip: a step the run asks for now, or any open step */
export async function skipSalesStep(store: Store, workspace: string, step: string): Promise<SalesSetupState | null> {
  if (!FLOW.steps.some((s) => s.id === step)) throw new DomainError('INVALID_INPUT', `Sales setup has no step ${step}`);
  const runs = runsOf(store);
  const run = await runs.get(workspace, FLOW.id);
  if (!run) throw new DomainError('NOT_FOUND', 'Sales setup has not started');
  if (run.completed_at || run.ended_at) return null;
  await runs.skip(run.id, step);
  return advanceSalesSetup(store, workspace);
}

/** setup.end: the opt-out with fewer leads (SO8). The session says so once */
export async function endSalesSetup(store: Store, workspace: string): Promise<void> {
  const runs = runsOf(store);
  const run = await runs.get(workspace, FLOW.id);
  if (!run) throw new DomainError('NOT_FOUND', 'Sales setup has not started');
  const where = await roomAndAgent(store, workspace);
  if (await runs.finish(run.id, 'ended') && run.thread_id && where) {
    await postAs(store, workspace, run.channel_id, run.thread_id, where.agent, `You ended setup. Sales keeps what you added, and the canvas keeps the steps you skipped. ${setupMarker(FLOW.id, 'ended')}`);
  }
}

export async function hideSalesSetup(store: Store, workspace: string): Promise<void> {
  const run = await runsOf(store).get(workspace, FLOW.id);
  if (!run) throw new DomainError('NOT_FOUND', 'Sales setup has not started');
  if (!run.completed_at && !run.ended_at) throw new DomainError('CONFLICT', 'Setup is still open. End it first');
  await runsOf(store).hide(run.id);
}

/** setup.answer: the company or the customer, merged onto the company profile with every other key kept */
export async function answerSalesStep(store: Store, workspace: string, a: { step: 'company' | 'customer'; website?: string | undefined; offer?: CompanyProfile['offer']; customer?: CompanyProfile['customer'] }): Promise<SalesSetupState | null> {
  const patch: Partial<CompanyProfile> = {};
  if (a.step === 'company') {
    if (!a.offer?.sells) throw new DomainError('INVALID_INPUT', 'say what you sell');
    patch.offer = a.offer;
    if (a.website) patch.website = a.website;
  } else {
    if (!a.customer || !Object.values(a.customer).some((v) => v.length)) throw new DomainError('INVALID_INPUT', 'name at least one part of your customer');
    patch.customer = a.customer;
  }
  await runsOf(store).mergeProfile(workspace, patch);
  return advanceSalesSetup(store, workspace);
}

/** the open run's id, for sales.add_leads to stamp on each deal it makes */
export async function openSalesRun(store: Store, workspace: string): Promise<string | null> {
  const run = await runsOf(store).get(workspace, FLOW.id);
  return run && !run.completed_at && !run.ended_at ? run.id : null;
}
