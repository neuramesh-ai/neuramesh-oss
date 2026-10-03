// where a web_screenshot lands (models-and-replies round, board C3), one maker per kind of turn,
// each the path that turn already uses for a picture.
//
//   · a conversation or an orchestrator turn posts it in its thread as an image attachment: a
//     message, then an inline file artifact on it, the way share_images does
//   · a working turn writes it into the task's .nm-evidence/, which the submit lifts onto the task
//     (evidence.ts), the way the screenshot tool's captures travel
//
// both answer the saved name, or null when the save failed, and the tool says which.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostCtx } from './ctx';
import type { LogFn } from '../agentlog';
import { webToolsFor, type WebTools } from '../browser/agent-tools';

type Actor = { kind: string; id: string; role?: string };

export const IN_THREAD = 'The person sees it in this thread.';
export const IN_EVIDENCE = 'It goes onto the task with your other evidence when you submit.';

/** `where` is read at save time: a conversation filed into another room mid-turn saves there */
export function threadShot(post: HostCtx['post'], actor: Actor, where: () => { workspaceId: string; channelId: string; threadId?: string | null; taskId?: string | null }) {
  return async (image: Buffer, name: string, mime: string): Promise<string | null> => {
    const at = where();
    const anchor = at.threadId ? { threadId: at.threadId } : at.taskId ? { taskId: at.taskId } : {};
    const posted = await post('/v1/messages', actor, { workspace: at.workspaceId, channel: at.channelId, ...anchor, body: 'A screenshot from the agents\' browser.' }).catch(() => null);
    const messageId = posted?.ok ? ((await posted.json().catch(() => null)) as { message?: { id?: string } } | null)?.message?.id : null;
    if (!messageId) return null;
    const ok = await post('/v1/artifacts', actor, {
      id: crypto.randomUUID(), workspace: at.workspaceId, channel: at.channelId, messageId, ...(at.taskId ? { taskId: at.taskId } : {}),
      kind: 'file', name, mime, inlineContent: `data:${mime};base64,${image.toString('base64')}`, sizeBytes: image.length,
    }).catch(() => null);
    return ok?.ok ? name : null;
  };
}

/** the five web tools for a working turn or a leg, which save into its evidence, or undefined with no Chromium */
export const workerWeb = (agentName: string, dir: string, log?: LogFn): WebTools | undefined =>
  webToolsFor({ agentName, savedWhere: IN_EVIDENCE, attach: evidenceShot(dir), ...(log ? { log } : {}) });

export function evidenceShot(dir: string) {
  return async (image: Buffer, name: string): Promise<string | null> => {
    try {
      const folder = join(dir, '.nm-evidence', 'web');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, name), image);
      return `web/${name}`;
    } catch { return null; }
  };
}
