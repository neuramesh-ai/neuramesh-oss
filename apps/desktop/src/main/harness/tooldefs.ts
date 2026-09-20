// THE TOOL TABLE — every nm tool's name, description, and input schema, in catalogue order.
//
// Split out of toolbus.ts, which was a 250-line data table wearing a 100-line module. The bus
// itself — what a turn may call, whether the host can service it, how an invocation runs — is
// logic; this is a list. They change for different reasons and are read for different reasons.
//
// The module-load assertion came WITH the table, deliberately: it is the guard that a name
// added to the shared catalogue without a definition here cannot be silently unavailable
// everywhere, and a guard belongs beside the thing it guards.
import { z } from 'zod';
import { NM_TOOLS } from '@neuramesh/shared';
import { TOOL_SPECS, type SpeccedTool } from './toolspec';
import { WHITEBOARD_DEFS } from './tooldefs-whiteboard';
import { text } from './toolbus';
import type { ToolDef, ToolHost } from './toolbus';

// name + description + schema come from THE ONE TABLE (toolspec.ts — shared with the Claude
// in-process server, 2026-08-18); what stays here is each tool's bus EXECUTION over ToolHost.
const spec = (name: SpeccedTool) => ({ name, description: TOOL_SPECS[name].description, params: TOOL_SPECS[name].params(z) });

export const DEFS: ToolDef[] = [
  {
    ...spec('screenshot'),
    async run(host, input) {
      if (!host.screenshot) return text('screenshots are unavailable here');
      if (!input['file'] && !input['url']) return text('screenshot needs either `file` (static .html) or `url` (a running app route)');
      try {
        const { png, outName } = await host.screenshot(input as Parameters<NonNullable<ToolHost['screenshot']>>[0]);
        host.log?.({ kind: 'tool', phase: 'call', summary: `screenshot ${String(input['url'] ?? input['file'])} → ${outName} (${Math.round(png.length / 1024)}KB)` });
        return { kind: 'image', base64: png.toString('base64'), mime: 'image/png', note: `captured ${outName}` };
      } catch (err) {
        return text(`screenshot failed: ${err instanceof Error ? err.message : 'render error'}`);
      }
    },
  },
  {
    ...spec('load_skill'),
    async run(host, input) {
      const want = String(input['name'] ?? '');
      const sk = (host.skills ?? []).find((x) => x.name === want);
      if (!sk) return text(`no active skill named "${want}" — check the available-skills list`);
      host.log?.({ kind: 'tool', phase: 'call', summary: `load_skill ${want}` });
      return text(`# Skill: ${sk.name}\n${sk.description}\n\n${sk.body}`);
    },
  },
  {
    ...spec('propose_skill'),
    async run(host, input) {
      if (!host.proposeSkill) return text('skill proposals are unavailable here');
      const name = String(input['name']);
      const r = await host.proposeSkill({
        name,
        description: String(input['description']),
        scope: (input['scope'] as 'channel' | 'global') ?? 'channel',
        body: String(input['body']),
      });
      host.log?.({ kind: 'tool', phase: 'call', summary: `propose_skill ${name}${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok ? `proposed skill "${name}" as a draft — the team will curate it` : `propose failed: ${r.error ?? 'error'}`);
    },
  },
  {
    ...spec('record_lesson'),
    async run(host, input) {
      if (!host.recordLesson) return text('lesson recording is unavailable here');
      const lesson = String(input['lesson']);
      const r = await host.recordLesson({ lesson });
      host.log?.({ kind: 'tool', phase: 'call', summary: `record_lesson "${lesson.slice(0, 80)}${lesson.length > 80 ? '…' : ''}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok ? 'lesson recorded in team memory — future tasks in this channel will see it' : `record failed: ${r.error ?? 'error'}`);
    },
  },
  {
    ...spec('add_backlog_item'),
    async run(host, input) {
      if (!host.addBacklogItem) return text('the backlog is unavailable here');
      const title = String(input['title']);
      const desc = input['description'] ? String(input['description']) : undefined;
      const r = await host.addBacklogItem({ title, ...(desc ? { description: desc } : {}) });
      host.log?.({ kind: 'tool', phase: 'call', summary: `add_backlog_item "${title.slice(0, 80)}"${r.ok ? ` → #${r.number}` : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok ? `parked as backlog item #${r.number} — a human or the orchestrator decides if/when it becomes work` : `add failed: ${r.error ?? 'error'}`);
    },
  },
  {
    ...spec('add_subtask'),
    async run(host, input) {
      if (!host.addBacklogItem) return text('subtasks are unavailable here');
      const title = String(input['title']);
      const desc = input['description'] ? String(input['description']) : undefined;
      const r = await host.addBacklogItem({ title, ...(desc ? { description: desc } : {}), parent: true });
      host.log?.({ kind: 'tool', phase: 'call', summary: `add_subtask "${title.slice(0, 80)}"${r.ok ? ` → #${r.number}` : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
      return text(r.ok ? `subtask #${r.number} created under this task — it must finish (or be cancelled) before this task can pass its next gate` : `add failed: ${r.error ?? 'error'}`);
    },
  },
  {
    ...spec('spawn'),
    async run(host, input) {
      if (!host.spawn) return text('fanning out is unavailable here');
      const role = String(input['role']);
      const label = input['label'] ? String(input['label']) : role;
      host.log?.({ kind: 'tool', phase: 'call', summary: `spawn ${role} · ${label}` });
      const r = await host.spawn({ role, prompt: String(input['prompt']), label });
      if (!r.ok) {
        host.log?.({ kind: 'tool', phase: 'result', summary: `spawn ${label} refused: ${r.error ?? 'error'}`, level: 'warn' });
        // the REASON matters: "budget exhausted" tells the model to stop fanning out and do the work
        // itself, where a bare failure would have it retry the same spawn until its wall expires.
        return text(`could not fan out "${label}": ${r.error ?? 'error'}`);
      }
      return text(`subagent "${label}" (${role}) finished:\n\n${r.summary ?? '(no summary)'}`);
    },
  },
  {
    ...spec('park'),
    async run(host, input) {
      if (!host.park) return text('parking is unavailable here — finish what you can and report what is unresolved');
      const until = String(input['until']);
      if (until === 'ci' && !input['prNumber']) return text('until:ci needs the prNumber whose checks you are waiting on');
      if (until === 'delay' && !input['afterMinutes']) return text('until:delay needs afterMinutes');
      const r = await host.park({
        until,
        ...(input['prNumber'] ? { prNumber: Number(input['prNumber']) } : {}),
        ...(input['afterMinutes'] ? { afterMinutes: Number(input['afterMinutes']) } : {}),
        note: String(input['note']),
      });
      if (!r.ok) return text(`could not park: ${r.error ?? 'error'} — carry on and finish what you can`);
      host.log?.({ kind: 'exec', phase: 'held', summary: `parked · ${until === 'ci' ? `CI on PR #${input['prNumber']}` : `${input['afterMinutes']}m`}` });
      // The model must now STOP. It cannot be interrupted mid-turn, so the instruction has to be
      // explicit — anything it does after this point happens before the turn actually ends.
      return text('Parked. END YOUR TURN NOW with a one-line summary of where you got to — do not start anything else. You will be called back when this resolves, with your note, and you continue from there.');
    },
  },
  {
    ...spec('declare_beats'),
    async run(host, input) {
      if (!host.beats) return text('progress steps are unavailable here');
      const steps = (input['steps'] as string[]) ?? [];
      const msg = host.beats.declare(steps);
      host.log?.({ kind: 'tool', phase: 'call', summary: `declare_beats (${steps.length} steps)` });
      return text(msg);
    },
  },
    // The repository reads (docs/design/github-connector-2026-09): closure-gated like search_x, one
  // implementation (host/reporead.ts) — the bus copies only log and forward.
  {
    ...spec('list_repo_changes'),
    async run(host, input) {
      if (!host.repo) return text('repository reads are unavailable on this turn');
      host.log?.({ kind: 'tool', phase: 'call', summary: `list_repo_changes${input['since'] ? ` since ${String(input['since']).slice(0, 10)}` : ''}` });
      return text(await host.repo.changes({ ...(input['since'] ? { since: String(input['since']) } : {}) }));
    },
  },
  {
    ...spec('read_repo_file'),
    async run(host, input) {
      if (!host.repo) return text('repository reads are unavailable on this turn');
      host.log?.({ kind: 'tool', phase: 'call', summary: `read_repo_file ${String(input['path']).slice(0, 80)}` });
      return text(await host.repo.file({ path: String(input['path']), ...(input['ref'] ? { ref: String(input['ref']) } : {}) }));
    },
  },
  {
    ...spec('list_repo_files'),
    async run(host, input) {
      if (!host.repo) return text('repository reads are unavailable on this turn');
      host.log?.({ kind: 'tool', phase: 'call', summary: `list_repo_files ${String(input['path'] ?? '/').slice(0, 80)}` });
      return text(await host.repo.tree({ ...(input['path'] ? { path: String(input['path']) } : {}), ...(input['ref'] ? { ref: String(input['ref']) } : {}) }));
    },
  },
  ...WHITEBOARD_DEFS,
  {
    ...spec('advance_beat'),
    async run(host, input) {
      if (!host.beats) return text('progress steps are unavailable here');
      const step = Number(input['step']);
      const blocked = input['blocked'] === true;
      const msg = host.beats.complete(step, blocked);
      host.log?.({ kind: 'tool', phase: 'call', summary: `advance_beat ${step}${blocked ? ' (blocked)' : ''}` });
      return text(msg);
    },
  },
  {
    ...spec('search_x'),
    async run(host, input) {
      if (!host.searchX) return text('X reads are unavailable on this turn');
      const query = String(input['query']);
      host.log?.({ kind: 'tool', phase: 'call', summary: `search_x ${query.slice(0, 60)}` });
      return text(await host.searchX({ query, ...(input['max'] ? { max: Number(input['max']) } : {}) }));
    },
  },
  {
    ...spec('draft_replies'),
    async run(host, input) {
      if (!host.draftReplies) return text('reply cards are unavailable on this turn — hand the conversations to your parent instead');
      // the codex bus delivers structured arguments as JSON STRINGS (the same quirk
      // resolvePlaybookInputs normalizes for `inputs`: a stringified list arrives, Array.isArray
      // is false, and the call silently becomes a no-op). Normalize BEFORE anything reads it.
      const raw = input['replies'];
      const replies = Array.isArray(raw)
        ? (raw as unknown[])
        : typeof raw === 'string'
          ? ((): unknown[] => { try { const p = JSON.parse(raw) as unknown; return Array.isArray(p) ? p : []; } catch { return []; } })()
          : [];
      host.log?.({ kind: 'tool', phase: 'call', summary: `draft_replies (${replies.length})` });
      return text(await host.draftReplies({
        replies,
        ...(typeof input['report'] === 'string' ? { report: input['report'] } : {}),
        ...(typeof input['baseline'] === 'string' ? { baseline: input['baseline'] } : {}),
      }));
    },
  },
];

// one assertion at module load, not a comment: a name added to the shared catalogue without a
// definition here would otherwise be silently unavailable everywhere.
{
  const defined = new Set(DEFS.map((d) => d.name));
  const missing = NM_TOOLS.filter((n) => !defined.has(n));
  if (missing.length) throw new Error(`toolbus: no definition for ${missing.join(', ')}`);
  if (defined.size !== DEFS.length) throw new Error('toolbus: duplicate tool definition');
}
