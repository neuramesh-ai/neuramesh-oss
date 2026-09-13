// The brain (docs/harness/01) — one directory per SUBJECT, shared by every agent that works it.
//
// The gap it closes: a thread's state is scattered across agent-logs.db (keyed by agent + run), a
// chats/ dir, and a worktree. Nothing is keyed by the SUBJECT — so a second agent woken in a thread
// gets a `limit 24` transcript tail and nothing the previous agent learned, decided, or wrote down.
//
// Keyed per subject because a subject OUTLIVES every agent that touches it: key on the agent and a
// handoff loses everything; key on the turn and there is nothing to inherit.
//
// Local only, under the locked 2026-06-13 privacy decision (tool I/O carries file contents, command
// output, possibly secrets): never the replica, never the cloud. Portability is by explicit encrypted
// export (docs/harness/01 §4), which is a deliberate act rather than a sync path.
//
// Run: pnpm exec tsx --test src/main/harness/brain.test.ts
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as resolvePath, sep } from 'node:path';
import type { AgentMessage, TurnKind } from '@neuramesh/shared';

export const BRAIN_SCHEMA_VERSION = 1;

/** What a brain is keyed on. A task uses its NUMBER (stable, human-legible); a thread its id. */
export type SubjectRef = { kind: 'thread'; id: string } | { kind: 'task'; number: number };

export function subjectSlug(s: SubjectRef): string {
  return s.kind === 'thread' ? `thread-${s.id.replace(/-/g, '').slice(0, 16)}` : `task-${s.number}`;
}

/**
 * The single local state root.
 *
 * `~/.neuramesh` rather than Electron's `userData` is what makes the harness runtime-agnostic: a
 * headless CLI (docs/harness/09) cannot call `app.getPath()`, so state must live at a path no runtime
 * owns. That path is also the one the user copies between machines, so the DEFAULT must stay fixed.
 *
 * It must not be fixed for everyone, though. Every profile launcher sets `NM_USERDATA`
 * (`~/.neuramesh-dev`, `~/.neuramesh-clerk`, …) precisely so a dev build and the installed app never
 * share state. v0.73.0 dropped that isolation in favour of NM_BRAIN and then set NM_BRAIN nowhere, so
 * both apps opened ONE `state/replica.db` — and since PowerSync keeps its checkpoint (`ps_buckets`)
 * and its outbound write queue (`ps_crud`) inside that file, each client kept invalidating the
 * other's checkpoint and re-syncing: the sidebar dropping to SYNCING… every few minutes.
 *
 * So the profile is honoured HERE rather than by asking each launcher to remember a second variable —
 * a launcher that forgets loses isolation silently, which is how this shipped. Precedence: an explicit
 * NM_BRAIN wins (a deliberate choice, including a restored export); otherwise a profile gets its own
 * root; otherwise the copyable default.
 */
export function brainRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env['NM_BRAIN']) return env['NM_BRAIN'];
  const profile = env['NM_USERDATA'];
  if (profile) return join(profile, 'brain');
  return join(env['HOME'] ?? homedir(), '.neuramesh');
}

export function subjectPath(s: SubjectRef, root = brainRoot()): string {
  return join(root, 'subjects', subjectSlug(s));
}

// ── The ledger ────────────────────────────────────────────────────────────────────────────────
// The canonical, replayable record of ONE turn. This is what agent-logs.db cannot be: that is a
// human-readable summary feed with `detail` capped at 8 KB. Three things need a replayable record —
// resume after a crash, a mid-turn runtime swap, and answering "why did the agent do that".
export type LedgerEntry =
  | { t: 'turn.open'; turnId: string; kind: TurnKind; agent: string; model: string; at: string }
  | { t: 'context'; source: 'notes' | 'recall' | 'transcript' | 'dod' | 'skills' | 'messages'; tokens: number }
  | { t: 'model.event'; role: 'assistant' | 'thinking'; text: string; tokens?: number }
  | { t: 'tool.call'; id: string; name: string; input: unknown }
  | { t: 'gate'; id: string; capability: string; verdict: 'allow' | 'ask' | 'deny'; reason: string }
  | { t: 'tool.result'; id: string; ok: boolean; output: string }
  | { t: 'spawn'; childTurnId: string; role: string; wallMs: number }
  | { t: 'checkpoint'; step: number; note: string }
  | { t: 'turn.settle'; state: 'done' | 'failed' | 'stopped'; summary: string; at: string };

// Belt-and-braces even though storage is local — the same pattern agent-logs.db already applies.
const SECRET = /\b(sk-ant-[a-z0-9-]{6,}|sk-[a-z0-9]{20,}|gh[ps]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,})/gi;
const redact = (s: string): string => s.replace(SECRET, '[redacted]');

export class Ledger {
  constructor(readonly file: string) {}

  /** Append one entry. Opened in 'a' mode per write: append-only within a turn, with no update path. */
  append(e: LedgerEntry): void {
    appendFileSync(this.file, redact(JSON.stringify(e)) + '\n', 'utf8');
  }

  /**
   * Replay the turn, stopping at the first unparseable line.
   *
   * A truncated tail is EXPECTED — a process killed mid-write leaves a partial line — so replay must
   * degrade rather than throw. The bad tail is preserved (see `quarantineTail`) for diagnosis instead
   * of being silently discarded.
   */
  replay(): { entries: LedgerEntry[]; truncatedAt: number | null } {
    if (!existsSync(this.file)) return { entries: [], truncatedAt: null };
    const entries: LedgerEntry[] = [];
    const lines = readFileSync(this.file, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!.trim();
      if (!line) continue;
      try {
        entries.push(JSON.parse(line) as LedgerEntry);
      } catch {
        return { entries, truncatedAt: i + 1 };
      }
    }
    return { entries, truncatedAt: null };
  }

  /** The resume point: the last checkpoint a turn committed. */
  lastCheckpoint(): { step: number; note: string } | null {
    const { entries } = this.replay();
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const e = entries[i]!;
      if (e.t === 'checkpoint') return { step: e.step, note: e.note };
    }
    return null;
  }

  /** Did this turn already settle? A settled ledger must not be resumed. */
  settled(): boolean {
    return this.replay().entries.some((e) => e.t === 'turn.settle');
  }

  /** Move a corrupt tail aside so replay stays clean and the evidence survives. */
  quarantineTail(): string | null {
    const { truncatedAt } = this.replay();
    if (truncatedAt == null) return null;
    const lines = readFileSync(this.file, 'utf8').split('\n');
    const bad = lines.slice(truncatedAt - 1).join('\n');
    writeFileSync(`${this.file}.bad`, bad, 'utf8');
    writeFileSync(this.file, lines.slice(0, truncatedAt - 1).join('\n') + '\n', 'utf8');
    return `${this.file}.bad`;
  }

  /** Stream large ledgers without loading them whole — used by `nm turn replay`. */
  async *stream(): AsyncIterable<LedgerEntry> {
    if (!existsSync(this.file)) return;
    const rl = createInterface({ input: createReadStream(this.file), crlfDelay: Infinity });
    for await (const line of rl) {
      const s = line.trim();
      if (!s) continue;
      try { yield JSON.parse(s) as LedgerEntry; } catch { return; }
    }
  }
}

// ── A subject's brain ─────────────────────────────────────────────────────────────────────────
export interface BrainIndex {
  subject: SubjectRef;
  notes: Array<{ name: string; bytes: number; mtimeMs: number }>;
  turns: string[];
  messages: number;
  workspaceFiles: number;
}

export class SubjectBrain {
  constructor(readonly path: string, readonly subject: SubjectRef) {}

  private dir(...p: string[]): string {
    const d = join(this.path, ...p);
    mkdirSync(d, { recursive: true });
    return d;
  }

  ledger(turnId: string): Ledger {
    return new Ledger(join(this.dir('turns'), `${turnId}.jsonl`));
  }

  workspaceDir(): string { return this.dir('workspace'); }

  /**
   * A note written FOR THE NEXT AGENT. This is the whole reason the brain is per-subject: an arriving
   * designer inherits what the orchestrator established, instead of a truncated transcript.
   */
  writeNote(name: string, body: string): void {
    const safe = name.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'note';
    writeFileSync(join(this.dir('notes'), safe.endsWith('.md') ? safe : `${safe}.md`), redact(body), 'utf8');
  }

  notes(): Array<{ name: string; body: string }> {
    const d = join(this.path, 'notes');
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => ({ name: f, body: readFileSync(join(d, f), 'utf8') }));
  }

  /** The envelope log (docs/harness/02) — how a parent collects its subtree's results. */
  appendMessage(m: AgentMessage): void {
    appendFileSync(join(this.path, 'messages.jsonl'), redact(JSON.stringify(m)) + '\n', 'utf8');
    mkdirSync(this.path, { recursive: true });
  }

  messages(): AgentMessage[] {
    const f = join(this.path, 'messages.jsonl');
    if (!existsSync(f)) return [];
    const out: AgentMessage[] = [];
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try { out.push(JSON.parse(s) as AgentMessage); } catch { /* skip a partial line */ }
    }
    return out;
  }

  /** Every result envelope from one parent's subtree, in order — the aggregation a fan-out needs. */
  collect(parentTurnId: string): AgentMessage[] {
    return this.messages().filter((m) => m.causedBy === parentTurnId || m.from.turnId === parentTurnId);
  }

  index(): BrainIndex {
    const notesDir = join(this.path, 'notes');
    const turnsDir = join(this.path, 'turns');
    const wsDir = join(this.path, 'workspace');
    return {
      subject: this.subject,
      notes: existsSync(notesDir)
        ? readdirSync(notesDir).filter((f) => f.endsWith('.md')).map((f) => {
            const st = statSync(join(notesDir, f));
            return { name: f, bytes: st.size, mtimeMs: st.mtimeMs };
          })
        : [],
      turns: existsSync(turnsDir) ? readdirSync(turnsDir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.jsonl$/, '')) : [],
      messages: this.messages().length,
      workspaceFiles: existsSync(wsDir) ? readdirSync(wsDir).length : 0,
    };
  }
}

// ── The root ──────────────────────────────────────────────────────────────────────────────────
export class Brain {
  constructor(readonly root = brainRoot()) {
    mkdirSync(this.root, { recursive: true });
    const manifest = join(this.root, 'brain.json');
    if (!existsSync(manifest)) {
      writeFileSync(manifest, JSON.stringify({ schemaVersion: BRAIN_SCHEMA_VERSION, createdAt: new Date().toISOString() }, null, 2));
    }
  }

  /** The manifest's schema version — an import of a NEWER brain must be refused, not best-efforted. */
  schemaVersion(): number {
    try {
      return (JSON.parse(readFileSync(join(this.root, 'brain.json'), 'utf8')) as { schemaVersion?: number }).schemaVersion ?? 0;
    } catch {
      return 0;
    }
  }

  open(s: SubjectRef): SubjectBrain {
    const p = subjectPath(s, this.root);
    mkdirSync(p, { recursive: true });
    const meta = join(p, 'subject.json');
    if (!existsSync(meta)) {
      writeFileSync(meta, JSON.stringify({ ...s, createdAt: new Date().toISOString() }, null, 2));
    }
    return new SubjectBrain(p, s);
  }

  /** Reclaim a subject's brain — called with the worktree reclaim on accepted/closed. */
  reclaim(s: SubjectRef): void {
    rmSync(subjectPath(s, this.root), { recursive: true, force: true });
  }

  subjects(): string[] {
    const d = join(this.root, 'subjects');
    return existsSync(d) ? readdirSync(d) : [];
  }
}

/**
 * Whether an imported brain can be opened by this build.
 *
 * Refusing a NEWER schema outright is deliberate: a partial import that "mostly worked" would leave a
 * user's only copy of their agents' memory in an unknown state, which is worse than a clear refusal
 * naming both versions.
 */
export function importCompatible(theirVersion: number): { ok: boolean; reason?: string } {
  if (theirVersion > BRAIN_SCHEMA_VERSION) {
    return { ok: false, reason: `this brain was written by a newer NeuraMesh (schema ${theirVersion}, this build reads ${BRAIN_SCHEMA_VERSION}) — update the app, then import` };
  }
  return { ok: true };
}

// ── Portability tiers (docs/harness/01 §4.2) ──────────────────────────────────────────────────
export type Tier = 'A' | 'B' | 'C';

/**
 * Which tier a brain-relative path belongs to, and therefore whether it may be exported.
 *
 *  A — irreplaceable: no cloud copy exists. This is what an export is FOR.
 *  B — rebuildable: a cache of cloud truth; optional in an export.
 *  C — machine-bound: worktrees are absolute-path-bound to their repo and BREAK when moved;
 *      credentials and sessions must never travel at all (doctrine §5.4).
 */
export function tierOf(relPath: string): Tier {
  const top = relPath.split('/')[0] ?? '';
  if (top === 'cache') return 'C';
  if (top === 'state') return 'B';
  if (relPath.endsWith('session.json') || relPath.includes('clerk-session')) return 'C';
  return 'A';
}

/** The export allowlist, as a predicate. Tier C never travels — asserted by a test, not by review. */
export function exportable(relPath: string, opts: { withCache?: boolean } = {}): boolean {
  const t = tierOf(relPath);
  if (t === 'C') return false;
  if (t === 'B') return opts.withCache === true;
  return true;
}

/**
 * A rebuildable working directory under the brain's `cache/` (docs/harness/01 §3.2, Tier C).
 *
 * These are the things a brain export must NOT carry: a git worktree is bound to its parent repo by
 * ABSOLUTE PATH, so copying one to another machine breaks it outright, and clones are large and
 * re-fetchable. Keeping them under `cache/` is what makes the export allowlist correct by shape
 * rather than by a denylist someone has to remember to update.
 *
 * ONE reader, because the migration that moved these directories did not update the code that writes
 * them — so the app happily recreated `~/.neuramesh/worktrees` beside the migrated
 * `~/.neuramesh/cache/worktrees`, orphaned every existing clone, and re-cloned from scratch. A path
 * spelled in seven places is a path that gets moved in one.
 */
export function cachePath(kind: 'worktrees' | 'repos' | 'donors' | 'design' | 'plan', leaf?: string): string {
  const base = join(brainRoot(), 'cache', kind);
  return leaf ? join(base, leaf) : base;
}

/** Scratch deliverables stay Tier A (they ARE the work) — under the root, not cache. */
export function deliverablePath(taskNumber: number): string {
  return join(brainRoot(), 'deliverables', `nm-${taskNumber}`);
}

/**
 * Resolve a model-supplied file name INSIDE a subject's workspace, or refuse.
 *
 * The name is data: it reaches us from a model that read it out of a listing, and a tool that hands
 * back arbitrary paths is a file-read primitive pointed at the user's disk. Resolving first and then
 * asserting the result is under the root is what makes `../`, an absolute path, and a symlink-free
 * traversal all impossible at once — a blocklist only covers the spellings someone thought of.
 *
 * Returns null on refusal so the caller states the reason in its own voice.
 */
export function resolveInWorkspace(workspaceDir: string, name: string): string | null {
  const root = resolvePath(workspaceDir);
  const full = resolvePath(root, name);
  return full === root || full.startsWith(root + sep) ? full : null;
}
