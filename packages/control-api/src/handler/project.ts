// Project commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,
  planLabel,








  type Actor,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import { localMode } from '../localmode';


import { type Store } from '../store';
import { actorAddress, requireConfirmCard, slugify } from './guards';




import type { CommandOutcome } from '../handler';

export async function projectCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  // ── Projects (the work axis) ───────────────────────────────────────────────
  // humans + the orchestrator manage the project list (the orchestrator creates
  // one during requirements when a new initiative spans the named channels).
  if (cmd.type === 'project.create') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'projects are managed by humans or the orchestrator');
    // the confirm-first rule is a FLOOR now, not etiquette: an agent create requires a recent
    // decision card naming this project (guards.ts requireConfirmCard — 2026-08-18)
    if (actor.kind === 'agent') await requireConfirmCard(store, cmd.workspace, cmd.name, 'creating a project');
    // Free caps the workspace at 3 projects — enforced here, not just in the UI (mirrors the
    // renderer's PROJECT_CAP). Cloud is unlimited; the PLAN_LIMIT error routes the desktop to the
    // upgrade flow instead of failing blind.
    // The local stack lifts the cap (localmode.ts).
    if (!localMode() && (await store.workspacePlan(cmd.workspace)) === 'free' && (await store.activeProjectCount(cmd.workspace)) >= 3) {
      throw new DomainError('PLAN_LIMIT', `${planLabel('free')} workspaces include up to 3 projects. Upgrade to ${planLabel('cloud')} for unlimited projects.`);
    }
    // the human may set the slug at creation; otherwise derive it from the name
    const baseSlug = cmd.slug ?? slugify(cmd.name);
    const event = createEvent({
      type: 'project.created',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'project', slug: baseSlug }),
      workspace: cmd.workspace,
      // the logo is a data: URL — events are append-only forever, so record presence, not bytes
      payload: { name: cmd.name, channels: cmd.channels, newChannels: cmd.newChannels ?? [], website: cmd.website ?? null, logo: cmd.logoUrl ? 'set' : null },
    });
    const { id, slug } = await store.createProject(
      { workspace: cmd.workspace, name: cmd.name, slug: baseSlug, description: cmd.description, website: cmd.website, logoUrl: cmd.logoUrl, channels: cmd.channels, newChannels: cmd.newChannels ?? [] },
      event,
    );
    return { ok: true, projectId: id, slug } as never;
  }
  // update/set_channels/archive carry only the project id — the workspace is
  // looked up by the store, which then stamps the event (the promoteArtifact /
  // promoteSkill makeEvent(workspace) precedent).
  if (cmd.type === 'project.update') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'projects are managed by humans or the orchestrator');
    const { id } = await store.updateProject(
      cmd.project,
      { name: cmd.name, description: cmd.description, website: cmd.website, logoUrl: cmd.logoUrl, autoOpenPr: cmd.autoOpenPr, runCiBeforeMerge: cmd.runCiBeforeMerge, shipGate: cmd.shipGate, modelPack: cmd.modelPack },
      (workspace) => createEvent({
        type: 'project.updated',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'project', slug: cmd.project }),
        workspace,
        // logo marker only ('' clears) — never the data: URL bytes in the append-only log
        payload: { name: cmd.name ?? null, description: cmd.description ?? null, website: cmd.website ?? null, logo: cmd.logoUrl === undefined ? null : cmd.logoUrl === '' ? 'cleared' : 'set', autoOpenPr: cmd.autoOpenPr ?? null, runCiBeforeMerge: cmd.runCiBeforeMerge ?? null, shipGate: cmd.shipGate ?? null, modelPack: cmd.modelPack ?? null },
      }),
    );
    return { ok: true, projectId: id } as never;
  }
  if (cmd.type === 'project.delete') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'projects are deleted by a human');
    const { id } = await store.deleteProject(
      cmd.project,
      actor.id,
      (workspace) => createEvent({
        type: 'project.deleted',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'project', slug: cmd.project }),
        workspace,
        payload: {},
      }),
    );
    console.log(`project_deleted id=${cmd.project} by=${actor.id}`);
    return { ok: true, projectId: id } as never;
  }
  // Left behind when this module was first split out: these branches sat in handler.ts
  // beside the FSM tail with no reason other than the order they were written in.

  if (cmd.type === 'project.archive' || cmd.type === 'project.unarchive') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'projects are managed by humans or the orchestrator');
    const archived = cmd.type === 'project.archive';
    const { id } = await store.archiveProject(
      cmd.project,
      archived,
      (workspace) => createEvent({
        type: 'project.archived',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'project', slug: cmd.project }),
        workspace,
        payload: { archived },
      }),
    );
    return { ok: true, projectId: id } as never;
  }

  return undefined;

}