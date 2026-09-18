import type { EngineeringActiveActivity, EngineeringMessage, EngineeringMode } from './domain';

export type EngineeringActivityKind = 'runtime' | 'brain' | 'read' | 'search' | 'edit' | 'command' | 'web' | 'mcp' | 'checkpoint' | 'verification' | 'other';
export type EngineeringActivityStatus = 'info' | 'success' | 'warning';

export interface EngineeringActivityPresentation {
  kind: EngineeringActivityKind;
  title: string;
  detail: string;
  status: EngineeringActivityStatus;
}

export interface EngineeringPlanItem {
  text: string;
  status: 'pending' | 'active' | 'complete';
}

/**
 * AICSS' Thinking + Reasoning demo folds a finished thought into a timed summary.
 * Our duration is derived from authoritative relay timestamps instead of a demo timer.
 */
export function engineeringReasoningSeconds(
  message: EngineeringMessage,
  nextMessage?: EngineeringMessage,
  now = Date.now(),
): number | null {
  const startedAt = Date.parse(message.createdAt);
  const finishedAt = message.streaming ? now : nextMessage ? Date.parse(nextMessage.createdAt) : Number.NaN;
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) return null;
  return Math.max(1, Math.min(999, Math.round((finishedAt - startedAt) / 1000)));
}

/** Render only statuses the plan actually declared. Numbered steps are neutral/pending. */
export function engineeringPlanItems(value: string): EngineeringPlanItem[] {
  return value.split('\n').flatMap((raw) => {
    // the item starts with a non-blank, so the blanks before it have one owner; the trailing
    // blanks leave by trim below (CodeQL js/polynomial-redos, 2026-09-18)
    const line = raw.replace(/\r$/, '');
    const checkbox = line.match(/^\s*[-*+]\s+\[([ xX~>-])\]\s+(\S.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(\S.*)$/);
    if (!checkbox && !numbered) return [];
    const marker = checkbox?.[1]?.toLowerCase();
    const text = (checkbox?.[2] ?? numbered?.[1] ?? '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .replace(/^\d+[.)]\s+/, '')
      .trim();
    if (!text) return [];
    return [{
      text,
      status: marker === 'x' ? 'complete' as const : marker && marker !== ' ' ? 'active' as const : 'pending' as const,
    }];
  }).slice(0, 20);
}

interface ToolCopy {
  kind: EngineeringActivityKind;
  done: string;
  active: string;
}

const TOOL_COPY: Record<string, ToolCopy> = {
  read_files: { kind: 'read', done: 'Read repository files', active: 'Reading repository files' },
  search_codebase: { kind: 'search', done: 'Searched the codebase', active: 'Searching the codebase' },
  editor: { kind: 'edit', done: 'Edited a file', active: 'Editing a file' },
  apply_patch: { kind: 'edit', done: 'Applied file changes', active: 'Applying file changes' },
  run_commands: { kind: 'command', done: 'Ran commands', active: 'Running commands' },
  fetch_web_content: { kind: 'web', done: 'Fetched web content', active: 'Fetching web content' },
};

const providerLabel = (value: string) => ({
  'openai-native': 'OpenAI',
  'openai-compatible': 'OpenAI compatible',
  anthropic: 'Anthropic',
  gemini: 'Google',
  google: 'Google',
  neuramesh: 'NeuraMesh',
}[value.toLowerCase()] ?? value.replace(/[-_]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()));

const titleCase = (value: string) => value
  .replace(/__+/g, ' · ')
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

function toolCopy(toolName: string): ToolCopy {
  if (TOOL_COPY[toolName]) return TOOL_COPY[toolName]!;
  if (toolName.includes('__')) return { kind: 'mcp', done: `Called ${titleCase(toolName)}`, active: `Calling ${titleCase(toolName)}` };
  return { kind: 'other', done: titleCase(toolName), active: `Using ${titleCase(toolName)}` };
}

function runtimeDetail(body: string): string {
  const [, provider = '', model = ''] = body.split(' · ');
  return [providerLabel(provider), model].filter(Boolean).join(' · ');
}

export function engineeringActivityPresentation(message: EngineeringMessage): EngineeringActivityPresentation {
  const body = message.body.trim();
  const warning = message.tone === 'warning' || /\b(?:failed|blocked|invalid|error)\b/i.test(body);

  if (body.startsWith('Engineering connected')) return { kind: 'runtime', title: 'Runtime connected', detail: runtimeDetail(body), status: 'info' };
  if (body.startsWith('Brain switched') || body.startsWith('Model switched')) return { kind: 'brain', title: 'Model changed', detail: runtimeDetail(body), status: 'info' };
  if (body.startsWith('Restored checkpoint')) return { kind: 'checkpoint', title: 'Restored checkpoint', detail: body.split(' · ').slice(1).join(' · '), status: 'success' };

  // the detail starts with a non-blank, so the blanks after the dot have one owner (CodeQL, 2026-09-18)
  const native = body.match(/^([a-z0-9_]+)(?:\s+)(completed|failed)(?:\s+·\s+(\S[\s\S]*))?$/i);
  if (native) {
    const copy = toolCopy(native[1]!);
    return {
      kind: copy.kind,
      title: copy.done,
      detail: native[2]?.toLowerCase() === 'failed' ? (native[3] || 'The action did not complete') : 'Completed',
      status: native[2]?.toLowerCase() === 'failed' ? 'warning' : 'success',
    };
  }

  if (/^Read \d+ files?\b/i.test(body)) return { kind: 'read', title: 'Read repository files', detail: body.replace(/^Read \d+ files?\s*·?\s*/i, ''), status: warning ? 'warning' : 'success' };
  if (/^Applied \d+ files?\b/i.test(body)) return { kind: 'edit', title: 'Applied file changes', detail: body, status: warning ? 'warning' : 'success' };
  if (/^✓/.test(body)) return { kind: 'verification', title: 'Verification passed', detail: body.replace(/^✓\s*/, ''), status: 'success' };

  return { kind: 'other', title: warning ? 'Action needs attention' : 'Engineering activity', detail: body, status: warning ? 'warning' : message.tone === 'success' ? 'success' : 'info' };
}

export function engineeringActivePresentation(
  activity: EngineeringActiveActivity | null | undefined,
  mode: EngineeringMode,
): EngineeringActivityPresentation {
  if (activity?.phase === 'tool' && activity.toolName) {
    const copy = toolCopy(activity.toolName);
    return { kind: copy.kind, title: copy.active, detail: 'Repository tool is running', status: 'info' };
  }
  if (activity?.phase === 'composing') return { kind: 'brain', title: 'Writing the response', detail: 'Turning the work into a clear handoff', status: 'info' };
  return mode === 'plan'
    ? { kind: 'search', title: 'Investigating the repository', detail: 'Building a safe, reviewable plan', status: 'info' }
    : { kind: 'edit', title: 'Working in the repository', detail: 'Changes and checks will appear here as they finish', status: 'info' };
}

export type EngineeringTranscriptBlock =
  | { kind: 'message'; message: EngineeringMessage }
  | { kind: 'activity'; messages: EngineeringMessage[] };

/** Keep partial Markdown readable without reparsing an incomplete document on every token. */
export const streamingEngineeringText = (value: string): string => value
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/\*\*/g, '')
  .replace(/`/g, '');

/** Consecutive machine receipts are one readable activity run, not a stack of repeated TOOL labels. */
export function groupEngineeringTranscript(messages: EngineeringMessage[]): EngineeringTranscriptBlock[] {
  const blocks: EngineeringTranscriptBlock[] = [];
  for (const message of messages) {
    if (message.role !== 'tool') {
      blocks.push({ kind: 'message', message });
      continue;
    }
    const last = blocks.at(-1);
    if (last?.kind === 'activity') last.messages.push(message);
    else blocks.push({ kind: 'activity', messages: [message] });
  }
  return blocks;
}
