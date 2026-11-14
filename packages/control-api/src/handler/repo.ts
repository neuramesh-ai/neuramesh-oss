// Repo commands — extracted from handler.ts (track C1).
//
// One exported entry per domain, returning `undefined` when the command is not its own so the
// chain in executeCommand carries on. Every branch is verbatim: the guards, the DomainError
// codes and the events are the product's contract, and this move is about where they live.
import {



  createEvent,


  formatAddress,








  type Actor,
  trimEndChars,






} from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';


import { bundleObject, memberOf, repoBundleStorage } from '../repo-bundles';
import { type Store } from '../store';
import { actorAddress, parseRepoUrl } from './guards';




import type { CommandOutcome } from '../handler';

export async function repoCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (cmd.type === 'repo.link') {
    // humans + the orchestrator register repos (orchestrator does it during
    // requirements once the human confirms the URL). Workers never do.
    const mayLink = actor.kind === 'human' || actor.role === 'orchestrator';
    if (!mayLink) throw new DomainError('NOT_PERMITTED', 'repos are registered by humans or the orchestrator');
    // A repo is either a remote URL (github/gitlab) or a local folder on the machine.
    let provider: string, orgName: string, name: string, cloneUrl: string | null, localPath: string | null;
    if (cmd.localPath) {
      provider = 'local';
      localPath = cmd.localPath;
      cloneUrl = null;
      orgName = 'local';
      name = cmd.name?.trim() || trimEndChars(cmd.localPath, '/\\').split(/[/\\]/).pop() || 'folder';
    } else if (cmd.url) {
      const parsed = parseRepoUrl(cmd.url);
      ({ provider, orgName, name, cloneUrl } = parsed);
      localPath = null;
      if (provider === 'bundle') {
        await assertBundleLinkable(store, actor, cmd.workspace, name);
        // the key names the upload; the person's name for it is the row's name when they gave one
        name = cmd.name?.trim() || name;
      }
    } else {
      throw new DomainError('INVALID_INPUT', 'provide a repo URL or a local folder path');
    }
    const event = createEvent({
      type: 'repo.linked',
      source: actorAddress(actor),
      // address segments can't contain '/', so join org+name with '-' for the id
      target: formatAddress({ kind: 'resource', type: 'repo', id: `${orgName}-${name}`.replace(/[^A-Za-z0-9._-]/g, '-') }),
      workspace: cmd.workspace,
      payload: { orgName, name, provider, channel: cmd.channel ?? null },
    });
    const { id, inserted } = await store.linkRepo(
      { workspace: cmd.workspace, channel: cmd.channel ?? null, project: cmd.project ?? null, provider, orgName, name, defaultBranch: cmd.defaultBranch, cloneUrl, localPath },
      event,
    );
    return { ok: true, repoId: id, inserted } as never;
  }
  return undefined;
}

/** a bundle row must point at an object that exists, in a workspace the caller belongs to: the object
 *  path is built from the command's workspace, so a stranger could otherwise probe another
 *  workspace's uploads, and a row that points at nothing fails only later, on a machine */
async function assertBundleLinkable(store: Store, actor: Actor, workspace: string, key: string): Promise<void> {
  if (!(await memberOf(store, actor, workspace))) throw new DomainError('NOT_PERMITTED', 'not your workspace');
  const storage = repoBundleStorage();
  if (!storage) throw new DomainError('INVALID_INPUT', 'bundle storage is not configured on this server');
  if (!(await storage.stat(bundleObject(workspace, key)))) throw new DomainError('NOT_FOUND', 'no uploaded bundle has that key in this workspace. Upload it first (POST /v1/repos/bundles/sign, then PUT the file).');
}
