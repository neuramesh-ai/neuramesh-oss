// THE WHITEBOARD TOOLS — create, update, list, read (docs/38).
//
// Four definitions split out of tooldefs.ts, which is otherwise a flat catalogue. They travel
// together because they are ONE subsystem: they share the WB_*_DESC descriptions, they are the
// agents' only diagram surface, and they arrive and leave the registries as a set. This is the
// same grouping the orchestrator's registry already uses (host/tools-*.ts).
import { z } from 'zod';
import { WB_CREATE_DESC, WB_LIST_DESC, WB_READ_DESC, WB_UPDATE_DESC } from './tooldesc';
import { text } from './toolbus';
import type { ToolDef } from './toolbus';

export const WHITEBOARD_DEFS: ToolDef[] = [
  {
    name: 'create_whiteboard',
    description: WB_CREATE_DESC,
    params: {
      title: z.string().min(1).max(200).describe('a short name for the board, e.g. "wake pipeline"'),
      mermaid: z.string().min(1).max(100_000).optional().describe('mermaid source — flowchart/sequence/class arrive as EDITABLE shapes; other kinds arrive as one image'),
      elements: z.string().min(1).max(200_000).optional().describe('an Excalidraw element-skeleton JSON array AS A STRING (rectangle/ellipse/diamond/arrow/text with x/y/width/height/label) for precise layouts'),
    },
    async run(host, input) {
      if (!host.whiteboards) return text('whiteboards are unavailable here');
      if (!input['mermaid'] === !input['elements']) return text('provide exactly one of `mermaid` or `elements`');
      const title = String(input['title']);
      const r = await host.whiteboards.create({ title, ...(input['mermaid'] ? { mermaid: String(input['mermaid']) } : {}), ...(input['elements'] ? { elements: String(input['elements']) } : {}) });
      host.log?.({ kind: 'tool', phase: 'call', summary: `create_whiteboard "${title.slice(0, 60)}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok
        ? `whiteboard "${title}" created (id ${r.id}) — its card is in the thread, and the first desktop to see it draws the scene; humans can then open and edit it`
        : `create failed: ${r.error ?? 'error'}`);
    },
  },
  {
    name: 'update_whiteboard',
    description: WB_UPDATE_DESC,
    params: {
      id: z.string().min(1).describe('the whiteboard id (from list_whiteboards or the conversation)'),
      baseRev: z.number().int().min(1).describe('the rev you READ this turn — the edit is refused if the board has moved past it'),
      title: z.string().min(1).max(200).optional().describe('a new name for the board'),
      mermaid: z.string().min(1).max(100_000).optional().describe('replacement mermaid source'),
      elements: z.string().min(1).max(200_000).optional().describe('replacement element-skeleton JSON array as a string'),
    },
    async run(host, input) {
      if (!host.whiteboards) return text('whiteboards are unavailable here');
      if (input['mermaid'] && input['elements']) return text('provide at most one of `mermaid` or `elements`');
      const r = await host.whiteboards.update({
        id: String(input['id']),
        baseRev: Number(input['baseRev']),
        ...(input['title'] ? { title: String(input['title']) } : {}),
        ...(input['mermaid'] ? { mermaid: String(input['mermaid']) } : {}),
        ...(input['elements'] ? { elements: String(input['elements']) } : {}),
      });
      host.log?.({ kind: 'tool', phase: 'call', summary: `update_whiteboard ${String(input['id']).slice(0, 8)}…${r.ok ? ` → rev ${r.rev}` : ' (refused)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok
        ? `whiteboard updated to rev ${r.rev} — the next desktop to see it redraws the scene`
        : `update refused: ${r.error ?? 'error'}`);
    },
  },
  {
    name: 'list_whiteboards',
    description: WB_LIST_DESC,
    params: { all: z.boolean().optional().describe('true = the whole workspace; default = this channel') },
    async run(host, input) {
      if (!host.whiteboards) return text('whiteboards are unavailable here');
      const r = await host.whiteboards.list({ all: input['all'] === true });
      return text(r.ok ? r.lines ?? '(none)' : `list failed: ${r.error ?? 'error'}`);
    },
  },
  {
    name: 'read_whiteboard',
    description: WB_READ_DESC,
    params: { id: z.string().min(1).describe('the whiteboard id') },
    async run(host, input) {
      if (!host.whiteboards) return text('whiteboards are unavailable here');
      const r = await host.whiteboards.read({ id: String(input['id']) });
      return text(r.ok ? r.text ?? '(empty board)' : `read failed: ${r.error ?? 'error'}`);
    },
  },
];
