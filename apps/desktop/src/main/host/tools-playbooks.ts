// Playbook tools (docs/design/marketing-os-2026-08) — the marketing flow catalog on rex's
// belt. `list_playbooks` answers "what can you do for marketing" with the registry joined to
// THIS room's derived state (last run + score from report-tagged artifacts, armed cadence
// from schedule prompts — nothing stored); `run_playbook` creates the unit from the
// registry's templated plan, so the template cannot drift between a tool call and a
// hand-written create. Chat-engine playbooks are refused BY SCHEMA (the enum), not by prose.
import {
  PLAYBOOKS,
  UNIT_PLAYBOOK_IDS,
  playbookById,
  playbookFromAsk,
  playbookOfReport,
  playbookPlan,
  reportFrom,
  resolvePlaybookInputs,
  type Playbook, checkNeeds, coverageNote, needBlock } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';
import { ghCapable } from './gh';
import { releaseDigestFor } from './releasedigest';

interface RoomState { lastAt: string | null; lastScore: number | null; armed: string | null }

/** the two reads, typed structurally so the chat registry can share it without the orch ctx */
type ReplicaDb = { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };

/** derive every playbook's room state in two reads — the same truth the destination renders */
async function roomStates(db: ReplicaDb, roomId: string): Promise<Map<string, RoomState>> {
  const out = new Map<string, RoomState>();
  // kind IN (doc, file): a submitted report lands as a `file` artifact and only becomes a
  // `doc` if a human promotes it — the round-3 live run proved the doc-only filter told
  // list_playbooks "never run" while the destination (which reads all kinds) said 86/100.
  // One derivation truth: name/title contract + inline content, whatever the kind.
  const arts = await db.getAll<{ id: string; name: string; created_at: string; inline_content: string | null }>(
    `select id, name, created_at, inline_content from artifacts where channel_id = ? and kind in ('doc', 'file') and inline_content is not null order by created_at desc limit 200`,
    [roomId],
  ).catch(() => []);
  for (const a of arts) {
    // identity = the name/title contract (playbooks.ts) — artifacts.tags never synced
    const meta = a.inline_content ? reportFrom(a.name, a.inline_content) : null;
    const pb = playbookOfReport(a.name, meta?.title ?? null);
    if (!pb || out.get(pb)?.lastAt) continue;
    out.set(pb, { lastAt: a.created_at, lastScore: meta?.score ?? null, armed: null });
  }
  const scheds = await db.getAll<{ payload: string | null; title: string; cadence: string }>(
    `select payload, title, cadence from schedules where channel_id = ? and status = 'active'`,
    [roomId],
  ).catch(() => []);
  for (const s of scheds) {
    let prompt = '';
    try { prompt = String((JSON.parse(s.payload ?? '{}') as { prompt?: string }).prompt ?? ''); } catch { /* unreadable */ }
    const pb = playbookFromAsk(prompt) ?? playbookFromAsk(s.title);
    if (!pb) continue;
    const cur = out.get(pb) ?? { lastAt: null, lastScore: null, armed: null };
    out.set(pb, { ...cur, armed: s.cadence });
  }
  return out;
}

function stateLine(pb: Playbook, s: RoomState | undefined): string {
  const bits: string[] = [];
  if (s?.lastScore != null) bits.push(`last score ${s.lastScore}/100`);
  if (s?.lastAt) bits.push(`last run ${s.lastAt.slice(0, 10)}`);
  else bits.push('never run here');
  if (s?.armed) bits.push(`armed ${s.armed}`);
  return bits.join(' · ');
}

/** ONE catalog rendering for both registries (orchestrator + chat) — they must never
 *  describe a playbook differently */
export async function playbookCatalogText(db: ReplicaDb, roomId: string): Promise<string> {
  const states = await roomStates(db, roomId);
  const room = (await db.getAll<{ kind: string | null }>(`select kind from channels where id = ?`, [roomId]).catch(() => []))[0];
  const marketing = room?.kind === 'marketing';
  const lines = PLAYBOOKS.map((p) => {
    const how = p.engine === 'unit'
      ? `unit via run_playbook('${p.id}')`
      : `in-thread: load_skill('${p.skill}') and answer here`;
    return `- ${p.id} — ${p.title}: ${p.tagline}. [${how}] (${stateLine(p, states.get(p.id))})`;
  });
  return `${marketing ? '' : 'NOTE: this is not a marketing room — playbooks run in a marketing HQ; suggest the right room first.\n'}` +
    `Marketing playbooks (marketing-os pack). Heavy flows run as units the moment they're asked for — no plan-review stop; the human's gate is accepting the deliverable. Light ones answer in the conversation.\n${lines.join('\n')}\n` +
    `Cross-cutting skills (never playbooks): honest-analytics, slop-patterns.`;
}

export function playbookTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, actor, thread, convoThreadId, log, here, known, apiGet } = tc;
  // ch carries no kind/marketing — read the (possibly filed-to) room's row when needed
  const roomRow = async (): Promise<{ kind: string | null; marketing: string | null }> =>
    (await db.getAll<{ kind: string | null; marketing: string | null }>(`select kind, marketing from channels where id = ?`, [here()]).catch(() => []))[0]
    ?? { kind: null, marketing: null };
  return [
    { name: 'list_playbooks', description: 'The marketing playbook catalog (marketing-os) joined to THIS room\'s state — what each flow does, how it runs (a unit you start with run_playbook, or answered here in the thread with its skill loaded), the last run + score, and any armed cadence. Consult it BEFORE improvising on a marketing ask; route the ask to the playbook it matches.', schema: {},
      run: async () => {
        log?.({ kind: 'tool', phase: 'call', summary: 'list_playbooks' });
        return playbookCatalogText(db, here());
      } },
    { name: 'run_playbook', description: 'START a marketing playbook from its registry template — no approval stop: the human\'s ask IS the consent for a canned template (only architect-authored plans go through plan review). In a CONVERSATION it creates a hands-off unit anchored here (born approved, starts immediately, the human accepts the deliverable at the end); in a TASK THREAD it creates a SUBTASK of that task, so the flow stays in one session and the deliverable attaches to the parent. Only unit-engine playbooks are runnable (chat ones you answer in place after load_skill). Inputs fall back to the room\'s marketing profile (url ← website); a missing required input is refused by name — ask the human instead of inventing a subject.', schema: {
      playbook: z.enum(UNIT_PLAYBOOK_IDS as [string, ...string[]]).describe('which playbook — from list_playbooks'),
      inputs: z.record(z.string()).optional().describe('the playbook\'s inputs by key (e.g. {"url": "https://…"} or {"competitor": "Linear, Height"}) — omit what the profile already knows'),
    }, run: async (input: { playbook: string; inputs?: Record<string, string> }) => {
      const pb = playbookById(input.playbook);
      if (!pb || pb.engine !== 'unit') return `error: '${input.playbook}' is not a runnable unit playbook`;
      const { values, missing } = resolvePlaybookInputs(pb, input.inputs ?? null, (await roomRow()).marketing);
      if (missing.length) {
        const shape = `{${missing.map((k) => `"${k}": "…"`).join(', ')}}`;
        const asks = missing.map((k) => pb.inputs.find((i) => i.key === k)?.label ?? k);
        return `MISSING_INPUT: ${pb.title} needs ${asks.join(' + ')} and the room's profile doesn't carry it — ask the human, then call run_playbook again with EXACTLY inputs: ${shape}.`;
      }
      // pre-offer the room's marketer (found live: the plan-release watch offers workers, and
      // a marketing room has none — the pre-offer is what lets the run start unattended)
      const [marketer] = await db.getAll<{ name: string }>(
        `select a.name from agents a join agent_channels ac on ac.agent_id = a.id
         where ac.channel_id = ? and a.role = 'marketer' and a.retired_at is null order by a.name limit 1`,
        [here()],
      ).catch(() => []);
      // ── DEPENDENCY PREFLIGHT (docs/design/triage-preflight-2026-08) ──────────────────────
      // Resolve what the run NEEDS before anything is staffed. The live failure this closes:
      // the radar was handed to a marketer in a room with no connected account, the worker had
      // nothing to read with, and the missing connector surfaced at the END as four tasks
      // asking the human to fix the thing that should have been the first question.
      //
      // Enforced HERE, where the unit is created — an orchestrator that can talk past a gate
      // is not a gate. Unmet ⇒ no task, no subtask, no offer; the card goes up instead.
      const connRows = await db.getAll<{ provider: string; status: string }>(
        `select k.provider, k.status from connectors k join channels c on c.id = ? and c.project_id = k.project_id`,
        [here()],
      ).catch(() => [] as Array<{ provider: string; status: string }>);
      // a `repo` need reads the room's project for its primary repository (release drafts)
      const [repoRow] = pb.needs?.some((n) => n.kind === 'repo')
        ? await db.getAll<{ org_name: string; name: string; project_id: string }>(
          `select r.org_name, r.name, c.project_id from repos r join project_repos pr on pr.repo_id = r.id
             join channels c on c.project_id = pr.project_id where c.id = ? order by coalesce(pr.is_primary, 0) desc limit 1`,
          [here()],
        ).catch(() => [] as Array<{ org_name: string; name: string; project_id: string }>)
        : [];
      // attached is not readable (docs/design/github-connector-2026-09): a cloud machine has no gh
      // login, so the repository reads only through the GitHub connector or this machine's gh
      const repoState = repoRow ? { slug: `${repoRow.org_name}/${repoRow.name}`, readable: connRows.some((k) => k.provider === 'github' && k.status === 'connected') || await ghCapable() } : null;
      const verdict = checkNeeds(pb.needs, connRows, repoState);
      if (!verdict.ok) {
        const need = pb.needs?.find((n) => n.kind === (verdict.repoMissing || verdict.repoUnreadable ? 'repo' : 'connector'));
        const [chRow] = verdict.repoMissing ? await db.getAll<{ project_id: string | null }>(`select project_id from channels where id = ?`, [here()]).catch(() => []) : [];
        const lead = verdict.repoMissing ? `${pb.title} needs a repository to read, and this room's project has none`
          : verdict.repoUnreadable ? `${pb.title} needs to read ${repoState?.slug}, and nothing here can: this machine has no GitHub login and GitHub is not connected`
          : `${pb.title} needs an account to read, and this room has none`;
        await post('/v1/messages', actor, {
          workspace: ch.workspace_id, channel: here(),
          ...(thread ? { taskId: thread.id } : convoThreadId ? { threadId: convoThreadId } : {}),
          body: `Before I staff this — ${lead}:\n\n${needBlock({
            channel: here(), ask: pb.title, why: need?.why ?? 'this playbook reads through the room\'s connected accounts',
            connect: verdict.repoMissing ? [] : verdict.repoUnreadable ? ['github'] : verdict.missing, readable: verdict.missing.filter((p) => p === 'x'),
            ...(verdict.repoMissing ? { attach: 'repo' as const, project: chRow?.project_id ?? null } : {}),
          })}`,
        }).catch(() => null);
        log?.({ kind: 'tool', phase: 'call', summary: `run_playbook ${pb.id} — blocked, ${verdict.repoMissing ? 'no repository' : verdict.repoUnreadable ? 'repository unreadable' : 'no connector'}` });
        return verdict.repoMissing
          ? `NOT created: ${pb.title} needs a repository and this room's project has none. The human has a card here to attach one — say plainly that you are waiting on it, and do NOT create a task, a subtask or a backlog item for it.`
          : verdict.repoUnreadable
            ? `NOT created: ${pb.title} needs to read ${repoState?.slug} and nothing here can. The human has a card here to connect GitHub (read only, one minute) — say plainly that you are waiting on it, and do NOT create a task, a subtask or a backlog item for it.`
            : `NOT created: ${pb.title} needs at least one connected account and this room has none. The human has a card here to connect one — say plainly that you are waiting on the connection, and do NOT create a task, a subtask or a backlog item for it. Connecting is theirs to do, not work to be staffed.`;
      }
      // what the run may READ, and how each connected network is covered (George, 2026-08-26:
      // one connector is enough, and a run covers every one that is live)
      values['coverage'] = coverageNote(verdict);
      // the plan is built AFTER the preflight: {coverage} is a RUN-time slot (which networks
      // are live and how each is read), so building the plan first bakes the literal in
      const plan = playbookPlan(pb, values);
      // the release digest at creation (docs/design/github-connector-2026-09 §3.4): a run asked for
      // in a thread that carries no digest read nothing, and plume judged from an empty page (the
      // live web run, 2026-09-19). The read rides the same two doors the tools use; a thread the
      // routine opened already carries its digest, and is left alone.
      const digest = pb.id === 'release' ? await releaseDigestFor({ db, apiGet, actor, channelId: here(), threadId: convoThreadId ?? thread?.id ?? null, release: values['release'] ?? null }).catch(() => null) : null;
      const digestNote = digest ? `\n\n${digest}` : '';

      // ── the TASK-THREAD lane (round 3, George): a playbook run asked for inside a task's
      // thread becomes that task's SUBTASK — the flow keeps one owning session, the deliverable
      // attaches to the parent, and the lean subtask life means it just runs.
      if (thread) {
        const res = await post('/v1/commands', actor, {
          type: 'task.create',
          workspace: ch.workspace_id,
          channel: here(),
          parent: thread.id,
          title: plan.title.slice(0, 72),
          description: `Playbook: ${pb.id} (marketing-os). ${pb.tagline}.\nInputs: ${JSON.stringify(values)}\n\n${plan.approach}\n\nDefinition of done: ${plan.definitionOfDone}${digestNote}`,
          ...(marketer ? { offerTo: marketer.name } : {}),
        });
        const body = (await res.json().catch(() => ({}))) as { task?: { id?: string; number?: number }; error?: string; code?: string };
        if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`;
        log?.({ kind: 'tool', phase: 'call', summary: `run_playbook ${pb.id} → subtask #${body.task?.number} of #${thread.number}` });
        return `subtask #${body.task?.number} (${pb.title}) created under #${thread.number} and offered to ${marketer?.name ?? 'the room'} — it runs without further approval and its deliverable lands on #${thread.number}. Say it is underway.`;
      }
      // ── the CONVERSATION lane: a hands-off unit anchored here — born approved (the ask is
      // the consent for a canned template; docs/design/marketing-os-2026-08 round 3), starts
      // as soon as the claim watch fires, and the human's gate is ACCEPT on the deliverable.
      const res = await post('/v1/commands', actor, {
        type: 'task.create',
        workspace: ch.workspace_id,
        channel: here(),
        title: plan.title.slice(0, 72),
        description: `Playbook: ${pb.id} (marketing-os). ${pb.tagline}.\nInputs: ${JSON.stringify(values)}${digestNote}`,
        kind: pb.taskKind ?? 'research',
        plan: { legs: plan.legs, subtasks: plan.subtasks, approach: plan.approach },
        definitionOfDone: plan.definitionOfDone,
        playbook: pb.id,
        ...(marketer ? { offerTo: marketer.name } : {}),
        ...(convoThreadId ? { originThread: convoThreadId } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as { task?: { id?: string; number?: number }; error?: string; code?: string };
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`;
      const n = body.task?.number;
      const createdId = body.task?.id;
      if (n && createdId) known.set(n, createdId); // the create→route chain must not depend on sync latency
      log?.({ kind: 'tool', phase: 'call', summary: `run_playbook ${pb.id} → #${n}` });
      return `#${n} created from the ${pb.title} playbook and STARTED — born approved${plan.subtasks.length ? ` with ${plan.subtasks.length} subtasks minted` : ''}, ${marketer?.name ?? 'the room'} picks it up now; the human's gate is accepting the deliverable. Its card is in this conversation — link #${n} and say it is underway.`;
    } },
  ];
}
