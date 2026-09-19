// Marketing commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { localMode } from '../localmode';
import { nextScheduleRun, playbookAsk, playbookById } from '@neuramesh/shared';


import { type Store } from '../store';
import { actorAddress } from './guards';




import type { CommandOutcome } from '../handler';

export async function marketingCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'marketing.setup') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'the marketing HQ is set up by a human');
    const focus = cmd.focus?.length ? cmd.focus : ['social', 'content'];
    // Round 4: the bootstrap is a CONVERSATION, not a task — onboarding analysis reads like
    // a colleague talking, never review ceremony. We mint the thread id here; the thread
    // itself births transactionally with its first message (pgstore.postMessage), and the
    // daemon's minute-tick picks up a one-shot bootstrap schedule to run the analysis in
    // that thread. The internal createSchedule bypasses the plan gate on purpose: the
    // paywall stays on ARMING a cadence (schedule.create), never on the free bootstrap.
    const threadId = crypto.randomUUID();
    const { id, workspace } = await store.setChannelMarketing(
      cmd.channel,
      {
        website: cmd.website ?? null, focus, ...(cmd.goal ? { goal: cmd.goal } : {}),
        // the last step's answer rides the completing command too: the wizard's per-step write races
        // this merge, and the loser's profile forgot the repository (live harness, 2026-09-18)
        ...(cmd.releases ? { releases: { repoId: cmd.releases.repoId ?? null, slug: cmd.releases.slug ?? null, now: cmd.releases.now, watch: cmd.releases.watch } } : {}),
        setup_by: actor.id, setup_at: new Date().toISOString(), bootstrap_thread_id: threadId,
      },
      (ws) => createEvent({
        type: 'marketing.setup',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, website: cmd.website ?? null, focus },
      }),
    );
    // ── Round 3 (2026-08-21, founder review): ONE session owns the whole first-run ──
    // The setup task's thread hosted the wizard and then sat EMPTY while the bootstrap went to
    // a separate "Brand foundation" conversation and every follow-up ask opened another row.
    // When the room has its setup task (docs/39 — every modern door plants one), the bootstrap
    // anchors THERE: docs, close and playbook subtasks all land in the task's own thread, and
    // the left nav gains nothing. The pre-birthed conversation survives only as the fallback
    // for pre-flows rooms that never had a setup task.
    const setupTaskId = await store.getSetupTaskId(id);
    if (!setupTaskId) {
      // pre-birth the thread TITLED — the human's setup message lands on this row (postMessage's
      // on-conflict path), so the sheet header reads "Brand foundation" from the first frame
      // and no agent-side retitle is needed (thread.update stays humans/orchestrator-only).
      await store.createThread(
        workspace, id, threadId, 'Brand foundation',
        cmd.website ? `Bootstrap analysis of ${cmd.website}` : 'Marketing bootstrap analysis',
        `${actor.kind}:${actor.id}`,
      );
    }
    const subject = cmd.website ? cmd.website : 'the product';
    await store.createSchedule(
      {
        channelId: id, title: 'Brand foundation', cadence: 'once',
        prompt:
          `Marketing HQ bootstrap. Study ${subject} and write the four brand docs — ` +
          `business-profile.md, brand-guidelines.md, market-research.md, social-strategy.md — ` +
          `grounded in the real site and public sources, never fabricated. Focus: ${focus.join(', ')}.`,
        atTime: '09:00', tz: 'UTC', weekday: null, nextRunAt: new Date().toISOString(),
        agentName: null, createdByKind: actor.kind, createdBy: actor.id,
        payloadExtra: setupTaskId ? { bootstrap: true, taskId: setupTaskId } : { bootstrap: true, threadId },
      },
      (ws) => createEvent({
        type: 'schedule.created',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, title: 'Brand foundation', cadence: 'once', bootstrap: true },
      }),
    );
    // ── step 5, release drafts (docs/design/release-drafts-2026-09 §4.7) ──
    // The one-shot "draft the latest release now" rides the internal createSchedule like the
    // bootstrap (free on every plan). The daily watch is a routine, so it meets the same plan
    // gate schedule.create enforces: refused on Free, and the answer says so.
    let releases: { now: boolean; watch: 'armed' | 'plan_limit' | 'off' } | undefined;
    if (cmd.releases && (cmd.releases.now || cmd.releases.watch)) {
      if (!cmd.releases.repoId) throw new DomainError('INVALID_INPUT', 'release drafts need a repository');
      const r = cmd.releases;
      const short = r.slug?.split('/')[1] ?? 'repository';
      const ask = playbookAsk(playbookById('release')!);
      const tz = r.tz ?? 'UTC';
      const at = r.at ?? '09:00';
      const nowIso = new Date().toISOString();
      const plant = (input: { title: string; cadence: 'once' | 'daily'; nextRunAt: string; release: Record<string, unknown> }) => store.createSchedule(
        { channelId: id, title: input.title, prompt: ask, cadence: input.cadence, atTime: at, tz, weekday: null, nextRunAt: input.nextRunAt, agentName: null, createdByKind: actor.kind, createdBy: actor.id, payloadExtra: { routine: true, release: input.release } },
        (ws) => createEvent({ type: 'schedule.created', source: actorAddress(actor), target: formatAddress({ kind: 'channel', slug: cmd.channel }), workspace: ws, payload: { channel: cmd.channel, title: input.title, cadence: input.cadence, nextRunAt: input.nextRunAt, release: true } }),
      );
      let watch: 'armed' | 'plan_limit' | 'off' = 'off';
      if (r.now) await plant({ title: `Release drafts · ${short} · the latest release`, cadence: 'once', nextRunAt: nowIso, release: { repo: r.repoId, slug: r.slug ?? null, latest: true } });
      if (r.watch) {
        if (!localMode() && (await store.workspacePlan(workspace)) === 'free') watch = 'plan_limit';
        else {
          const next = nextScheduleRun({ cadence: 'daily', atTime: at, tz, weekday: null, after: new Date() });
          if (!next) throw new DomainError('INVALID_INPUT', 'could not compute the next run — check the time and timezone');
          await plant({ title: `Release drafts · ${short}`, cadence: 'daily', nextRunAt: next.toISOString(), release: { repo: r.repoId, slug: r.slug ?? null, cursor: { at: nowIso, tag: null }, log: [] } });
          watch = 'armed';
        }
      }
      releases = { now: !!r.now, watch };
    }
    // the client opens (and posts the human's answers into) whichever session owns the
    // first-run — the setup task when the room has one, the legacy conversation otherwise.
    // Returning threadId in BOTH cases would let the card's summary message birth the
    // conversation thread anyway (postMessage's on-conflict path), undoing the anchoring.
    return { ok: true, channelId: id, ...(setupTaskId ? { taskId: setupTaskId } : { threadId }), ...(releases ? { releases } : {}) } as never;
  }
  if (cmd.type === 'marketing.set_integration') {
    if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'integrations are managed by a human');
    const { id } = await store.setMarketingIntegration(
      cmd.channel, cmd.provider, cmd.enabled,
      (ws) => createEvent({
        type: 'marketing.setup',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace: ws,
        payload: { channel: cmd.channel, integration: cmd.provider, enabled: cmd.enabled },
      }),
    );
    return { ok: true, channelId: id } as never;
  }
  return undefined;
}
