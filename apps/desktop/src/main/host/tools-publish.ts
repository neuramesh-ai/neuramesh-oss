// ASK TO PUBLISH, AND PUBLISH ON REQUEST (docs/design/inbox-sales-2026-11/plan.md I14 point 4, I15). ask_publish
// posts a card in the conversation, `‹publish:<file>|<for>›`, and only a person selects Publish there.
// publish_file (George, 2026-11-24) publishes when the person asked for it: the API takes an agent only when a
// person typed in the session in the last 30 minutes, the file is in a room of the agent, and every check of a
// person's Publish passes (publish-agent.ts). The rule is the server's: this tool only names the file and the
// session. The API posts the link in the session, where the person can remove it.
//
// The file may be in any room the agent is in (George, 2026-11-24): a new session runs in the project's context
// room, and the file is often in Files in another room. The tools take the file's id (list_library shows it), and
// a name only as a fallback, found in the agent's own rooms. The server holds the file: nothing here reads it, and
// the agent never copies a file to publish it.
import { publishAskMarker, publishableName } from '@neuramesh/shared';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { LogFn } from '../agentlog';
import type { HostCtx } from './ctx';
import type { OrchTool } from './orchtools';

export interface PublishToolCtx {
  z: typeof import('zod')['z'];
  db: ReplicaDatabase;
  post: HostCtx['post'];
  ch: { id: string; workspace_id: string };
  actor: { kind: string; id: string; role?: string };
  /** the message the card anchors to: a task thread's task, or a conversation's thread */
  anchor: () => { taskId: string } | { threadId: string } | null;
  log?: LogFn;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CANNOT = (name: string) => `"${name}" cannot be published. Only an MP4 or WebM video, a PNG, JPEG, WebP or GIF image, or an HTML page can. Never SVG or PDF.`;

export function publishTools(t: PublishToolCtx): OrchTool[] {
  const { z } = t;
  const schema = {
    file: z.string().min(1).max(512).describe('the file\'s id from list_library (scope project or workspace finds a file of any room you are in), or its exact name'),
    for: z.string().max(200).optional().describe('one short line on what the link is for, for example "The video block in the email to Lena"'),
  };
  type Found = { id: string; name: string; room: string | null };
  // an id: the file itself. a name: this room first, then the other rooms of the agent (the ACL of Files). The same
  // name in two other rooms is a question, never a guess
  const find = async (want: string): Promise<Found | string> => {
    const key = want.trim();
    if (UUID.test(key)) {
      const [hit] = await t.db.getAll<Found>(
        `select a.id, a.name, c.slug as room from artifacts a join agent_channels ac on ac.channel_id = a.channel_id and ac.agent_id = ?
         left join channels c on c.id = a.channel_id where a.id = ? and a.workspace_id = ? limit 1`, [t.actor.id, key.toLowerCase(), t.ch.workspace_id],
      ).catch(() => [] as Found[]);
      return hit ?? `No file in Files in your rooms has the id ${key}. Call list_library with scope project or workspace for the ids.`;
    }
    const rows = await t.db.getAll<Found & { here: number }>(
      `select a.id, a.name, c.slug as room, (a.channel_id = ?) as here from artifacts a
       join agent_channels ac on ac.channel_id = a.channel_id and ac.agent_id = ? left join channels c on c.id = a.channel_id
       where a.workspace_id = ? and lower(a.name) = lower(?) order by here desc, a.created_at desc limit 20`, [t.ch.id, t.actor.id, t.ch.workspace_id, key],
    ).catch(() => [] as Array<Found & { here: number }>);
    if (!rows.length) return `No file named "${key}" is in Files in your rooms. Call list_library with scope project or workspace, and use the file's id.`;
    if (Number(rows[0]!.here)) return rows[0]!;
    const rooms = [...new Set(rows.map((r) => r.room ?? '?'))];
    if (rooms.length > 1) return `"${key}" is in more than one room (${rooms.map((r) => `#${r}`).join(', ')}). Call list_library with scope project, and use the id of the right file.`;
    return rows[0]!;
  };
  return [{
    name: 'ask_publish',
    description: 'Ask the person to publish a file from Files to a link on neuramesh.page that anyone with the link can open: a video for an email\'s video block, an image or GIF, or an HTML page for customers or investors. It posts a card, and only a person selects Publish. When the person asked you to publish, use publish_file. Name the file by its id from list_library: the file can be in any room you are in. Files that can go out: MP4 or WebM, PNG, JPEG, WebP or GIF, or one self-contained HTML page (never SVG or PDF). Before you make a NEW page, load_skill publish-page: a page works in light and dark and at phone width, holds its images as data: URLs, and has no secrets, no forms and no calls out. After the card, wait for the person\'s Publish.',
    schema,
    run: async (input: { file: string; for?: string }): Promise<string> => {
      const anchor = t.anchor();
      if (!anchor) return 'ask_publish needs a conversation to post the card into. Ask inside the thread.';
      const file = await find(input.file);
      if (typeof file === 'string') return file;
      if (!publishableName(file.name)) return CANNOT(file.name);
      const res = await t.post('/v1/messages', t.actor, { workspace: t.ch.workspace_id, channel: t.ch.id, ...anchor, body: publishAskMarker(file.id, input.for ?? '') }).catch(() => null);
      t.log?.({ kind: 'tool', phase: 'call', summary: `ask_publish — ${file.name}`, level: res?.ok ? 'info' : 'warn' });
      if (!res?.ok) return 'The card did not post. Say so in one line, and do not claim the file is published.';
      return `The publish card for "${file.name}" is in the thread. Only the person can publish it. Do not say it is published, and do not invent a link: wait for their Publish, which puts the link in the thread.`;
    },
  }, {
    name: 'publish_file',
    description: 'Publish a file from Files to a public link on neuramesh.page, only when the person asked you to publish it in this conversation. Name the file by its id from list_library (scope project or workspace): the file can be in any room you are in, and the link comes here. The server holds the file, so publish it as it is. Do not read the file, and never copy it to publish it. Read a file only to make a NEW page, for example from a Markdown document. A file in Files is not in the repository, so do not look for it there. The server refuses when no person typed here in the last 30 minutes, and checks the file as for a person\'s Publish. It posts the link here, where the person can remove it. Without the request, use ask_publish. The skill publish-page helps you make a page. You do not need it to publish a file.',
    schema,
    run: async (input: { file: string; for?: string }): Promise<string> => {
      const anchor = t.anchor();
      if (!anchor) return 'publish_file needs the conversation where the person asked. Publish inside the thread.';
      const file = await find(input.file);
      if (typeof file === 'string') return file;
      if (!publishableName(file.name)) return CANNOT(file.name);
      const session = 'taskId' in anchor ? { task: anchor.taskId } : { thread: anchor.threadId };
      const res = await t.post('/v1/publish', t.actor, { workspace: t.ch.workspace_id, artifact: file.id, ...session, for: input.for ?? '' }).catch(() => null);
      const out = (await res?.json().catch(() => null)) as { link?: { url: string }; error?: string; code?: string } | null;
      t.log?.({ kind: 'tool', phase: 'call', summary: `publish_file — ${file.name}`, level: res?.ok ? 'info' : 'warn' });
      if (!res?.ok || !out?.link) {
        const why = out?.error ?? 'The server did not answer.';
        return out?.code === 'HUMAN_WORD' || out?.code === 'UPDATE_NEEDS_PERSON'
          ? `Not published: ${why} Call ask_publish for "${file.name}" instead.`
          : `Not published: ${why} Say so in one line, and do not claim the file is published.`;
      }
      return `Published "${file.name}" at ${out.link.url}. The link and Remove link are in the thread. Use this link exactly, and never invent one.`;
    },
  }];
}
