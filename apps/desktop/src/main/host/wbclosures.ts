// THE WHITEBOARD TOOL CLOSURES — how an agent's create/update/list/read calls reach the board.
//
// Split out of startAgentHost to sit with the rest of the whiteboard lane (docs/38). Agents
// write through the strict command path, never local rows: a lost race comes back as
// WHITEBOARD_STALE rather than silently clobbering a newer revision, which is the whole reason
// this is a closure over an actor and a room rather than a bare db handle.
import type { Actor } from '@neuramesh/shared';
import { apiAuthHeaders } from '../apiauth';
import { whiteboardShareBody } from '@neuramesh/shared';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { HostCtx } from './ctx';

export function makeWbClosures(ctx: HostCtx & {
  apiUrl: string;
}) {
  const { apiUrl, post } = ctx;

  // Whiteboards (docs/38): the four tool closures, built once per call site. Reads are
  // workspace-wide (George's ruling — an agent may read any board); writes ride the strict
  // command lane (rev-guarded, WHITEBOARD_STALE on a lost race); a created board's card posts
  // straight into the conversation that asked, through the same message lane humans use.
  function whiteboardClosures(
    actor: { kind: string; id: string; role?: string },
    ch: { id: string; workspace_id: string },
    at: { taskId?: string; threadId?: string },
  ): WhiteboardToolClosures {
    const get = async (path: string) => fetch(`${apiUrl}${path}`, { headers: await apiAuthHeaders(apiUrl, actor as Actor) });
    return {
      list: async (i) => {
        try {
          const res = await get(`/v1/whiteboards?${i.all ? `workspace=${ch.workspace_id}` : `channel=${ch.id}`}&limit=40`);
          if (!res.ok) return { ok: false, error: `list failed (${res.status})` };
          const { whiteboards } = (await res.json()) as { whiteboards: Array<{ id: string; title: string; rev: number; updatedAt: string; createdByKind: string; hasSource: boolean }> };
          if (!whiteboards.length) return { ok: true, lines: i.all ? 'no whiteboards in this workspace yet' : 'no whiteboards in this channel yet — create_whiteboard makes one' };
          return { ok: true, lines: whiteboards.map((w) => `- "${w.title}" · id ${w.id} · rev ${w.rev} · by ${w.createdByKind}${w.hasSource ? ' · not yet drawn' : ''} · ${w.updatedAt}`).join('\n') };
        } catch { return { ok: false, error: 'request failed' }; }
      },
      read: async (i) => {
        try {
          const res = await get(`/v1/whiteboards/${encodeURIComponent(i.id)}`);
          if (res.status === 404) return { ok: false, error: 'no whiteboard with that id — list_whiteboards shows what exists' };
          if (!res.ok) return { ok: false, error: `read failed (${res.status})` };
          const { whiteboard: w } = (await res.json()) as { whiteboard: { id: string; title: string; rev: number; channelId: string; scene: string | null; source: string | null } };
          const src = w.source ? (JSON.parse(w.source) as { kind: string; value: string }) : null;
          // 24k-char cap mirrors read_library_doc — a board is context, not the whole context
          const bodyText = src
            ? `pending ${src.kind} source (no desktop has drawn it yet):\n${src.value.slice(0, 24_000)}`
            : w.scene
              ? `Excalidraw scene JSON:\n${w.scene.slice(0, 24_000)}${w.scene.length > 24_000 ? '\n…(truncated)' : ''}`
              : 'an empty board';
          return { ok: true, text: `# ${w.title}\nid ${w.id} · rev ${w.rev}\n\n${bodyText}` };
        } catch { return { ok: false, error: 'request failed' }; }
      },
      create: async (i) => {
        try {
          const res = await post('/v1/commands', actor, {
            type: 'whiteboard.create',
            channel: ch.id,
            ...(at.threadId ? { threadId: at.threadId } : {}),
            ...(at.taskId ? { taskId: at.taskId } : {}),
            title: i.title,
            ...(i.mermaid ? { mermaid: i.mermaid } : {}),
            ...(i.elements ? { elements: i.elements } : {}),
          });
          const body = (await res.json().catch(() => ({}))) as { whiteboardId?: string; error?: string };
          if (!res.ok) return { ok: false, error: body.error ?? `create failed (${res.status})` };
          const id = String(body.whiteboardId ?? '');
          await post('/v1/messages', actor, {
            workspace: ch.workspace_id,
            channel: ch.id,
            ...(at.taskId ? { taskId: at.taskId } : {}),
            ...(at.threadId ? { threadId: at.threadId } : {}),
            body: whiteboardShareBody(i.title, id),
          }).catch(() => null);
          return { ok: true, id };
        } catch { return { ok: false, error: 'request failed' }; }
      },
      update: async (i) => {
        try {
          const res = await post('/v1/commands', actor, {
            type: 'whiteboard.update',
            whiteboardId: i.id,
            baseRev: i.baseRev,
            ...(i.title ? { title: i.title } : {}),
            ...(i.mermaid ? { mermaid: i.mermaid } : {}),
            ...(i.elements ? { elements: i.elements } : {}),
          });
          const body = (await res.json().catch(() => ({}))) as { rev?: number; error?: string; code?: string };
          if (!res.ok) return { ok: false, error: body.code === 'WHITEBOARD_STALE' ? `${body.error} (read_whiteboard again, then retry with the new rev)` : body.error ?? `update failed (${res.status})` };
          return { ok: true, rev: body.rev };
        } catch { return { ok: false, error: 'request failed' }; }
      },
    };
  }

  return { whiteboardClosures };
}
