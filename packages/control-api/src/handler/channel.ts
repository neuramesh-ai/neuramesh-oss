// Channel commands — extracted from handler.ts (track C1).
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


import { type Store } from '../store';
import { actorAddress } from './guards';


import type { CommandOutcome } from '../handler';

export async function channelCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'channel.assign') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'projects are managed by humans or the orchestrator');
    const { id } = await store.assignChannel(
      cmd.channel,
      cmd.project,
      (workspace) => createEvent({
        type: 'project.updated',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'project', slug: cmd.project }),
        workspace,
        payload: { channel: cmd.channel },
      }),
    );
    return { ok: true, channelId: id } as never;
  }
  // Channel (room) CRUD — humans + the orchestrator create/rename; delete is human-only
  // (it destroys message + task history, like project.delete).
  if (cmd.type === 'channel.create') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'channels are managed by humans or the orchestrator');
    const event = createEvent({
      type: 'channel.created',
      source: actorAddress(actor),
      target: formatAddress({ kind: 'channel', slug: cmd.slug }),
      workspace: cmd.workspace,
      payload: { slug: cmd.slug, project: cmd.project, topic: cmd.topic },
    });
    const { id, slug } = await store.createChannel(
      { workspace: cmd.workspace, projectId: cmd.project, slug: cmd.slug, topic: cmd.topic, createdByKind: actor.kind, createdBy: actor.id },
      event,
    );
    return { ok: true, channelId: id, slug } as never;
  }
  if (cmd.type === 'channel.rename') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'channels are managed by humans or the orchestrator');
    if (cmd.slug === undefined && cmd.topic === undefined) throw new DomainError('INVALID_INPUT', 'nothing to rename');
    const { id, slug } = await store.renameChannel(
      cmd.channel,
      { slug: cmd.slug, topic: cmd.topic },
      (workspace) => createEvent({
        type: 'channel.renamed',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.slug ?? cmd.channel }),
        workspace,
        payload: { channel: cmd.channel, slug: cmd.slug ?? null, topic: cmd.topic ?? null },
      }),
    );
    return { ok: true, channelId: id, slug } as never;
  }
  if (cmd.type === 'channel.set_thread_mode') {
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'channels are managed by humans or the orchestrator');
    const { id } = await store.setChannelThreadMode(
      cmd.channel,
      cmd.mode,
      (workspace) => createEvent({
        type: 'channel.thread_mode_set',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: { channel: cmd.channel, mode: cmd.mode },
      }),
    );
    return { ok: true, channelId: id } as never;
  }
  if (cmd.type === 'channel.set_kind') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'a room changes trade only by a human');
    const { id } = await store.setChannelKind(
      cmd.channel,
      cmd.kind,
      (workspace) => createEvent({
        type: 'channel.kind_set',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: { channel: cmd.channel, kind: cmd.kind },
      }),
    );
    return { ok: true, channelId: id } as never;
  }
  if (cmd.type === 'channel.delete') {
    if (actor.kind !== 'human') throw new DomainError('NOT_PERMITTED', 'channels are deleted by a human');
    const { id } = await store.deleteChannel(
      cmd.channel,
      (workspace) => createEvent({
        type: 'channel.deleted',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: {},
      }),
    );
    console.log(`channel_deleted id=${cmd.channel} by=${actor.id}`);
    return { ok: true, channelId: id } as never;
  }
  // Left behind when this module was first split out: these branches sat in handler.ts
  // beside the FSM tail with no reason other than the order they were written in.

  if (cmd.type === 'channel.add_agent' || cmd.type === 'channel.remove_agent') {
    // agents are workspace-scoped; humans (the live-panel "+") or the orchestrator (the
    // "add @agent?" card) bring them into a channel's context. Workers can't self-add.
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'channel membership is managed by humans or the orchestrator');
    const add = cmd.type === 'channel.add_agent';
    const fn = add ? store.addAgentToChannel.bind(store) : store.removeAgentFromChannel.bind(store);
    const { agentId, channelId } = await fn(
      cmd.workspace, cmd.channel, cmd.agent,
      (workspace) => createEvent({
        type: 'agent.channels_synced',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: { agent: cmd.agent, channel: cmd.channel, op: add ? 'add' : 'remove' },
      }),
      { kind: actor.kind, id: actor.id },
    );
    console.log(`agent_channel_${add ? 'added' : 'removed'} agent=${cmd.agent} channel=${cmd.channel} by=${actor.id}`);
    return { ok: true, agentId, channelId } as never;
  }

  if (cmd.type === 'channel.add_person' || cmd.type === 'channel.remove_person') {
    // Same gate as the agent roster: humans and the orchestrator curate a room's line-up.
    // The person must already be a member of the workspace — this adds them to a ROOM, it
    // never grants workspace access (that's the invite flow, which costs a seat).
    const mayManage = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayManage) throw new DomainError('NOT_PERMITTED', 'channel membership is managed by humans or the orchestrator');
    const add = cmd.type === 'channel.add_person';
    const fn = add ? store.addPersonToChannel.bind(store) : store.removePersonFromChannel.bind(store);
    const { userId, channelId } = await fn(
      cmd.workspace, cmd.channel, cmd.person,
      (workspace) => createEvent({
        type: 'channel.people_synced',
        source: actorAddress(actor),
        target: formatAddress({ kind: 'channel', slug: cmd.channel }),
        workspace,
        payload: { person: cmd.person, channel: cmd.channel, op: add ? 'add' : 'remove' },
      }),
      actor.kind === 'human' ? actor.id : null,
    );
    console.log(`channel_person_${add ? 'added' : 'removed'} person=${cmd.person} channel=${cmd.channel} by=${actor.id}`);
    return { ok: true, userId, channelId } as never;
  }

  return undefined;

}