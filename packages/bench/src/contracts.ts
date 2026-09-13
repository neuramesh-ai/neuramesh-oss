// The benchmark reads the SHIPPED contracts — defaults/agents/*.yaml — never a copy.
//
// History (2026-08-18 audit, defect A7): packages/shared/src/prompts.ts carried hand-synced
// duplicates of the worker and reviewer prompts "for the benchmark harness", and they drifted —
// the live contracts gained the .nm-evidence/ rule, the lessons clause and the turn-is-the-
// execution paragraph while the copies kept none of them. So the leaderboard measured a prompt
// no agent runs. This loader ends the copy: what ships is what benchmarks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { composePrompt } from '@neuramesh/shared';

interface Contract { prompt?: Record<string, string> }

const cache = new Map<string, Record<string, string>>();
function contractPrompt(role: string): Record<string, string> {
  const hit = cache.get(role);
  if (hit) return hit;
  // packages/bench/src → repo root; bench is a repo-internal harness, so the repo layout IS the API
  const file = join(import.meta.dirname, '..', '..', '..', 'defaults', 'agents', `${role}.yaml`);
  const doc = load(readFileSync(file, 'utf8')) as Contract;
  const prompt = doc.prompt ?? {};
  cache.set(role, prompt);
  return prompt;
}

/** Minimal task shape the coding turn needs (a structural subset of the host's ExecTask). */
export interface CodingTaskInput {
  number: number;
  title: string;
  /** JSON array of resolved-requirement checklist strings, or null (legacy rows). */
  requirements?: string | null;
}

/**
 * The coding turn a CLI-runtime worker actually receives, composed from worker.yaml exactly the
 * way runtime/adapter.ts composes it — repo-backed, no rework, no nm-tool bus, no skills (bench
 * models run tool-less). Optional blocks compose to '' just as they do in the daemon.
 */
export function benchCodingPrompt(t: CodingTaskInput, opts?: { repoBacked?: boolean; reworkNotes?: string | null }): string {
  const w = contractPrompt('worker');
  const repoBacked = opts?.repoBacked ?? true;
  let checklist: string[] = [];
  try {
    checklist = t.requirements ? (JSON.parse(t.requirements) as string[]) : [];
  } catch { /* legacy rows */ }
  const rework = (opts?.reworkNotes ?? '').trim();
  return composePrompt(w['turn'] ?? '', {
    'task.number': String(t.number),
    'task.title': t.title,
    briefBlock: '',
    checklistBlock: checklist.length ? `\n${composePrompt(w['checklist'] ?? '', { items: checklist.map((c) => `- ${c}`).join('\n') })}\n` : '',
    channelBlock: '',
    lessonsNote: '',
    reworkBlock: rework ? `\n${composePrompt(w['rework'] ?? '', { notes: rework })}\n` : '',
    attachmentsNote: '',
    nmToolsBlock: '',
    skillsBlock: '',
    where: composePrompt(repoBacked ? (w['where.repo'] ?? '') : (w['where.scratch'] ?? ''), {}),
  });
}

/** The reviewer's verdict system prompt — the strict gate, verbatim from reviewer.yaml. */
export function reviewVerdictSystem(): string {
  return contractPrompt('reviewer')['verdict.system'] ?? '';
}

export interface ReviewInput {
  definitionOfDone: string;
  checklist?: string[];
  /** e.g. '\n\nSystem CI gate: PR CI is green.' — the host's separate CI note. */
  ciNote?: string;
  /** e.g. 'bound; pushed abc1234567' | 'none (repo-less scratch run)'. */
  repoBinding?: string;
  artifacts: { kind: string; name: string }[];
  workerSummary: string;
}

/**
 * The reviewer's user message, composed from reviewer.yaml `verdict.user` with the same variable
 * names host/reviewflow.ts passes. The criteria labels mirror the host's assembly (its one
 * remaining inline string); the TEMPLATE — what shapes the judgement — comes from the contract.
 */
export function benchReviewUserPrompt(input: ReviewInput): string {
  const { definitionOfDone, checklist = [], ciNote = '', repoBinding = 'none (repo-less scratch run)', artifacts, workerSummary } = input;
  const criteria = definitionOfDone
    ? `Definition of Done — the AUTHORITATIVE acceptance contract; gate on THIS:\n${definitionOfDone}${checklist.length ? `\n\nResolved requirements (intake checklist, supporting context):\n${checklist.map((c) => `- ${c}`).join('\n')}` : ''}`
    : `Requirements / checklist:\n${checklist.map((c) => `- ${c}`).join('\n')}`;
  return composePrompt(contractPrompt('reviewer')['verdict.user'] ?? '', {
    criteria,
    designNote: '',
    ciNote,
    lessonsNote: '',
    repoBinding,
    artifacts: artifacts.map((a) => `- [${a.kind}] ${a.name}`).join('\n') || '(none)',
    summary: workerSummary.slice(0, 2000),
  });
}
