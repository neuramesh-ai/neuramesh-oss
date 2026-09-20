// THE WORKER'S OWN TOOLS — the in-process MCP server a Claude worker gets on top of the SDK's
// file + shell tools: screenshots, whiteboards, skills, backlog items, lessons.
//
// Split out of the claude runtime, where it was ~220 of its ~340 lines. Two different jobs sat
// in one function: deciding what a worker CAN DO, and running its turn. This is the first.
//
// The SDK and node bits are imported HERE rather than passed down: they are dynamic imports in
// the runtime too (the SDK stays out of the main bundle), and the module registry caches, so
// the second await costs nothing and the seam reads as a module instead of a parameter list.
import { IMAGE_EXT } from '../evidence';
import type { createBeatRun } from '../beats';
import { TOOL_SPECS, type SpeccedTool } from '../harness/toolspec';
import { repoClones } from './nmtools-repo';
import { WB_CREATE_DESC, WB_LIST_DESC, WB_READ_DESC, WB_UPDATE_DESC } from '../harness/tooldesc';
import type { SkillRef } from '../agents';
import type { LogFn } from '../agentlog';
import type { TurnOpts } from './adapter';

/** the beat-run handle the runtime builds — INFERRED from createBeatRun, never restated.
 *  `null` when a prompt override suppresses beats. */
type BeatRun = ReturnType<typeof createBeatRun> | null;

export async function nmToolServer(a: {
  /** the worktree or scratch dir the tools write into */
  dir: string;
  log?: LogFn;
  skills?: SkillRef[];
  proposeSkill?: (input: { name: string; description: string; scope: 'channel' | 'global'; body: string }) => Promise<{ ok: boolean; error?: string }>;
  recordLesson?: (input: { lesson: string }) => Promise<{ ok: boolean; error?: string }>;
  addBacklogItem?: (input: { title: string; description?: string; parent?: boolean }) => Promise<{ ok: boolean; number?: number; error?: string }>;
  opts?: TurnOpts;
  beatRun: BeatRun;
}) {
  const { dir, log, skills, proposeSkill, recordLesson, addBacklogItem, opts, beatRun } = a;
  const { join, resolve } = await import('node:path');
  const { writeFile } = await import('node:fs/promises');
  const { z } = await import('zod');
  const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  const { renderHtmlFileToPng, renderUrlToPng } = await import('../render');
  // name + description + schema come from THE ONE TABLE (harness/toolspec.ts — shared with the
  // CLI loopback bus, 2026-08-18; the two hand-carried copies had already drifted on spawn/park).
  // What stays here is each tool's in-process execution over the SDK closures.
  const S = <K extends SpeccedTool>(name: K): (typeof TOOL_SPECS)[K] => TOOL_SPECS[name];

  return createSdkMcpServer({
    name: 'nm',
    tools: [
      tool(
        'screenshot',
        S('screenshot').description,
        S('screenshot').params(z),
        async (input) => {
          try {
            if (!input.file && !input.url) return { content: [{ type: 'text' as const, text: 'screenshot needs either `file` (static .html) or `url` (a running app route)' }] };
            const png = input.url
              ? await renderUrlToPng(input.url, { width: input.width, height: input.height })
              : await renderHtmlFileToPng(resolve(dir, input.file!), { width: input.width, height: input.height });
            const slug = input.url
              ? (input.url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'route')
              : input.file!.replace(/\.html?$/i, '');
            // ALWAYS end in an image extension so the submit's screenshot-collection (which matches by
            // extension) picks it up even when the agent names it without one (e.g. "ping-route").
            const outName = input.name
              ? (IMAGE_EXT.test(input.name) ? input.name : `${input.name}.png`)
              : `${slug}.png`;
            await writeFile(join(dir, outName), png);
            log?.({ kind: 'tool', phase: 'call', summary: `screenshot ${input.url ?? input.file} → ${outName} (${Math.round(png.length / 1024)}KB)` });
            return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
          } catch (err) {
            return { content: [{ type: 'text' as const, text: `screenshot failed: ${err instanceof Error ? err.message : 'render error'}` }] };
          }
        },
      ),
      tool(
        'load_skill',
        S('load_skill').description,
        S('load_skill').params(z),
        async (input) => {
          const sk = (skills ?? []).find((x) => x.name === input.name);
          if (!sk) return { content: [{ type: 'text' as const, text: `no active skill named "${input.name}" — check the available-skills list` }] };
          log?.({ kind: 'tool', phase: 'call', summary: `load_skill ${input.name}` });
          return { content: [{ type: 'text' as const, text: `# Skill: ${sk.name}\n${sk.description}\n\n${sk.body}` }] };
        },
      ),
      // The four board-adjacent tools are CLOSURE-GATED like their whiteboard/spawn/park siblings
      // (2026-08-18 audit, defect A4): a design round passes none of these closures, and the old
      // unconditional registration advertised four tools that could only answer "unavailable
      // here" — the codebase's own rule is that such a tool must not exist rather than refuse.
      // The runtime fallbacks inside each stay as the belt under this suspender.
      ...(proposeSkill ? [
      tool(
        'propose_skill',
        S('propose_skill').description,
        S('propose_skill').params(z),
        async (input) => {
          if (!proposeSkill) return { content: [{ type: 'text' as const, text: 'skill proposals are unavailable here' }] };
          const r = await proposeSkill({ name: input.name, description: input.description, scope: input.scope ?? 'channel', body: input.body });
          log?.({ kind: 'tool', phase: 'call', summary: `propose_skill ${input.name}${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
          return { content: [{ type: 'text' as const, text: r.ok ? `proposed skill "${input.name}" as a draft — the team will curate it` : `propose failed: ${r.error ?? 'error'}` }] };
        },
      ),
      ] : []),
      ...(recordLesson ? [
      tool(
        'record_lesson',
        S('record_lesson').description,
        S('record_lesson').params(z),
        async (input) => {
          if (!recordLesson) return { content: [{ type: 'text' as const, text: 'lesson recording is unavailable here' }] };
          const r = await recordLesson({ lesson: input.lesson });
          log?.({ kind: 'tool', phase: 'call', summary: `record_lesson "${input.lesson.slice(0, 80)}${input.lesson.length > 80 ? '…' : ''}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
          return { content: [{ type: 'text' as const, text: r.ok ? 'lesson recorded in team memory — future tasks in this channel will see it' : `record failed: ${r.error ?? 'error'}` }] };
        },
      ),
      ] : []),
      ...(addBacklogItem ? [
      tool(
        'add_backlog_item',
        S('add_backlog_item').description,
        S('add_backlog_item').params(z),
        async (input) => {
          if (!addBacklogItem) return { content: [{ type: 'text' as const, text: 'the backlog is unavailable here' }] };
          const r = await addBacklogItem({ title: input.title, ...(input.description ? { description: input.description } : {}) });
          log?.({ kind: 'tool', phase: 'call', summary: `add_backlog_item "${input.title.slice(0, 80)}"${r.ok ? ` → #${r.number}` : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
          return { content: [{ type: 'text' as const, text: r.ok ? `parked as backlog item #${r.number} — a human or the orchestrator decides if/when it becomes work` : `add failed: ${r.error ?? 'error'}` }] };
        },
      ),
      tool(
        'add_subtask',
        S('add_subtask').description,
        S('add_subtask').params(z),
        async (input) => {
          if (!addBacklogItem) return { content: [{ type: 'text' as const, text: 'subtasks are unavailable here' }] };
          const r = await addBacklogItem({ title: input.title, ...(input.description ? { description: input.description } : {}), parent: true });
          log?.({ kind: 'tool', phase: 'call', summary: `add_subtask "${input.title.slice(0, 80)}"${r.ok ? ` → #${r.number}` : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
          return { content: [{ type: 'text' as const, text: r.ok ? `subtask #${r.number} created under this task — it must finish (or be cancelled) before this task can pass its next gate` : `add failed: ${r.error ?? 'error'}` }] };
        },
      ),
      ] : []),
      ...(opts?.whiteboards ? [
        tool(
          'create_whiteboard',
          WB_CREATE_DESC,
          {
            title: z.string().min(1).max(200).describe('a short name for the board, e.g. "wake pipeline"'),
            mermaid: z.string().min(1).max(100_000).optional().describe('mermaid source — flowchart/sequence/class arrive as EDITABLE shapes; other kinds arrive as one image'),
            elements: z.string().min(1).max(200_000).optional().describe('an Excalidraw element-skeleton JSON array AS A STRING for precise layouts'),
          },
          async (input) => {
            if (!input.mermaid === !input.elements) return { content: [{ type: 'text' as const, text: 'provide exactly one of `mermaid` or `elements`' }] };
            const r = await opts!.whiteboards!.create({ title: input.title, ...(input.mermaid ? { mermaid: input.mermaid } : {}), ...(input.elements ? { elements: input.elements } : {}) });
            log?.({ kind: 'tool', phase: 'call', summary: `create_whiteboard "${input.title.slice(0, 60)}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
            return { content: [{ type: 'text' as const, text: r.ok ? `whiteboard "${input.title}" created (id ${r.id}) — its card is in the thread, and the first desktop to see it draws the scene; humans can then open and edit it` : `create failed: ${r.error ?? 'error'}` }] };
          },
        ),
        tool(
          'update_whiteboard',
          WB_UPDATE_DESC,
          {
            id: z.string().min(1).describe('the whiteboard id (from list_whiteboards or the conversation)'),
            baseRev: z.number().int().min(1).describe('the rev you READ this turn — refused if the board has moved past it'),
            title: z.string().min(1).max(200).optional().describe('a new name for the board'),
            mermaid: z.string().min(1).max(100_000).optional().describe('replacement mermaid source'),
            elements: z.string().min(1).max(200_000).optional().describe('replacement element-skeleton JSON array as a string'),
          },
          async (input) => {
            if (input.mermaid && input.elements) return { content: [{ type: 'text' as const, text: 'provide at most one of `mermaid` or `elements`' }] };
            const r = await opts!.whiteboards!.update({ id: input.id, baseRev: input.baseRev, ...(input.title ? { title: input.title } : {}), ...(input.mermaid ? { mermaid: input.mermaid } : {}), ...(input.elements ? { elements: input.elements } : {}) });
            log?.({ kind: 'tool', phase: 'call', summary: `update_whiteboard ${input.id.slice(0, 8)}…${r.ok ? ` → rev ${r.rev}` : ' (refused)'}`, level: r.ok ? 'info' : 'warn' });
            return { content: [{ type: 'text' as const, text: r.ok ? `whiteboard updated to rev ${r.rev} — the next desktop to see it redraws the scene` : `update refused: ${r.error ?? 'error'}` }] };
          },
        ),
        tool(
          'list_whiteboards',
          WB_LIST_DESC,
          { all: z.boolean().optional().describe('true = the whole workspace; default = this channel') },
          async (input) => {
            const r = await opts!.whiteboards!.list({ all: input.all === true });
            return { content: [{ type: 'text' as const, text: r.ok ? r.lines ?? '(none)' : `list failed: ${r.error ?? 'error'}` }] };
          },
        ),
        tool(
          'read_whiteboard',
          WB_READ_DESC,
          { id: z.string().min(1).describe('the whiteboard id') },
          async (input) => {
            const r = await opts!.whiteboards!.read({ id: input.id });
            return { content: [{ type: 'text' as const, text: r.ok ? r.text ?? '(empty board)' : `read failed: ${r.error ?? 'error'}` }] };
          },
        ),
      ] : []),
      ...(opts?.spawn ? [
        tool(
          'spawn',
          S('spawn').description,
          S('spawn').params(z),
          async (input) => {
            const label = (input.label ?? input.role).slice(0, 80);
            const r = await opts!.spawn!({ role: input.role, prompt: input.prompt, label });
            log?.({ kind: 'tool', phase: 'result', summary: `spawn ${label} ${r.ok ? 'done' : `refused: ${r.error ?? 'error'}`}`, level: r.ok ? 'info' : 'warn' });
            return { content: [{ type: 'text' as const, text: r.ok ? `subagent "${label}" (${input.role}) finished:\n\n${r.summary ?? '(no summary)'}` : `could not fan out "${label}": ${r.error ?? 'error'}` }] };
          },
        ),
      ] : []),
      ...(opts?.park ? [
        tool(
          'park',
          S('park').description,
          S('park').params(z),
          async (input) => {
            const r = await opts!.park!({ until: input.until, ...(input.prNumber ? { prNumber: input.prNumber } : {}), ...(input.afterMinutes ? { afterMinutes: input.afterMinutes } : {}), note: input.note });
            if (!r.ok) return { content: [{ type: 'text' as const, text: `could not park: ${r.error ?? 'error'} — carry on and finish what you can` }] };
            log?.({ kind: 'exec', phase: 'held', summary: `parked · ${input.until === 'ci' ? `CI on PR #${input.prNumber}` : `${input.afterMinutes}m`}` });
            return { content: [{ type: 'text' as const, text: 'Parked. END YOUR TURN NOW with a one-line summary of where you got to — do not start anything else. You will be called back when this resolves.' }] };
          },
        ),
      ] : []),
      // X reads on a research leg (marketing-os round) — closure-gated like spawn/park: the
      // host provides it only where TOOL_KINDS grants it, and host/searchx.ts is the one impl.
      ...(opts?.searchX ? [
        tool(
          'search_x',
          S('search_x').description,
          S('search_x').params(z),
          async (input) => {
            log?.({ kind: 'tool', phase: 'call', summary: `search_x ${String(input.query).slice(0, 60)}` });
            return { content: [{ type: 'text' as const, text: await opts!.searchX!({ query: input.query, ...(input.max ? { max: input.max } : {}) }) }] };
          },
        ),
      ] : []),
      // The reply card (reply-radar round) — closure-gated like search_x above: the host hands
      // it to the turns TOOL_KINDS grants, and host/tools-replies.ts is the one card writer.
      ...(opts?.draftReplies ? [
        tool(
          'draft_replies',
          S('draft_replies').description,
          S('draft_replies').params(z),
          async (input) => {
            const r = await opts!.draftReplies!(input as { report?: string; baseline?: string; replies: unknown[] });
            log?.({ kind: 'tool', phase: 'call', summary: `draft_replies (${(input as { replies?: unknown[] }).replies?.length ?? 0})` });
            return { content: [{ type: 'text' as const, text: r }] };
          },
        ),
      ] : []),
      // the repository reads (docs/design/github-connector-2026-09): closure-gated like search_x (nmtools-repo.ts)
      ...(opts?.repo ? repoClones(opts.repo, tool, z, log) : []),
      // Beats (docs/17): the runtime-OWNED write path for the worker's live progress
      // plan. TodoWrite still maps automatically when the model uses it, but these
      // tools are the primary the prompt instructs — beats must never again depend on
      // the harness's tool-availability policy (the #1010 no-plan failure: TodoWrite
      // silently absent from the SDK session's default toolset). Worker runs only.
      ...(beatRun ? [
        tool(
          'declare_beats',
          S('declare_beats').description,
          S('declare_beats').params(z),
          async (input) => {
            const msg = beatRun.declare(input.steps);
            log?.({ kind: 'tool', phase: 'call', summary: `declare_beats (${input.steps.length} steps)` });
            return { content: [{ type: 'text' as const, text: msg }] };
          },
        ),
        tool(
          'advance_beat',
          S('advance_beat').description,
          S('advance_beat').params(z),
          async (input) => {
            const msg = beatRun.complete(input.step, input.blocked === true);
            log?.({ kind: 'tool', phase: 'call', summary: `advance_beat ${input.step}${input.blocked ? ' (blocked)' : ''}` });
            return { content: [{ type: 'text' as const, text: msg }] };
          },
        ),
      ] : []),
    ],
  });
}
