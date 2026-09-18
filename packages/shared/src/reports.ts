// Scored reports (docs/design/marketing-os-2026-08) — the pure half of the ReportCard.
//
// The articles.ts pattern, applied to the playbooks' scored deliverables: a report IS a doc
// artifact; this is the ONE parse every surface renders from — the thread card, the Files
// preview and the destination's score chips cannot disagree about what the report scored.
// The honesty spine is enforced here, not prompted: a doc with no `Score: NN/100` head or no
// `## What I couldn't determine` section is NOT a report — `reportFrom` returns null, the
// runner's shape guard bounces it (the `looksLikeDoc` idiom), and the renderer falls back to
// the plain doc card rather than dressing an unaccountable number in a dial.

export interface ReportDim {
  label: string;
  score: number; // 0–100
}

export interface ReportMeta {
  /** first `# ` heading */
  title: string;
  /** the weighted total from the head line — 0–100 */
  score: number;
  /** what was actually accessed (`Basis: …` on the head line) — '' when unstated */
  basis: string;
  /** rows of the `## Scorecard` table (label + first 0–100 number per row) */
  dims: ReportDim[];
  /** items under `## Fix these first` (or `## Do these first`) */
  fixFirst: number;
  /** the gaps section's text, single-spaced — its PRESENCE is what makes this a report */
  gaps: string;
}

const SCORE_RE = /score:\s*(\d{1,3})\s*\/\s*100/i;
const GAPS_HEAD_RE = /^#{2,3}\s+what\s+i\s+couldn[’']?t\s+determine\s*$/im;

function section(md: string, headRe: RegExp): string | null {
  const m = headRe.exec(md);
  if (!m) return null;
  const tail = md.slice(m.index + m[0].length);
  return (tail.split(/\n#{1,6}\s/)[0] ?? '').trim();
}

/**
 * Parse a doc artifact as a scored report. Null unless the shape contract holds:
 * a title, `Score: NN/100` within the first five lines, and the gaps section present
 * (empty-bodied gaps still count — "none" is a statement; a MISSING section is the lie).
 */
export function reportFrom(name: string, markdown: string): ReportMeta | null {
  const md = markdown.trim();
  const title = /^#[ \t]+(\S.*)$/m.exec(md)?.[1]?.trim() ?? '';
  if (!title) return null;

  const head = md.split('\n').slice(0, 5).join('\n');
  const scoreM = SCORE_RE.exec(head);
  if (!scoreM) return null;
  const score = Number(scoreM[1]);
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;

  if (!GAPS_HEAD_RE.test(md)) return null;
  const gaps = (section(md, GAPS_HEAD_RE) ?? '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  const basisM = /basis:\s*([^\n]+)/i.exec(head);
  const basis = (basisM?.[1] ?? '').replace(/\s*·\s*$/, '').trim();

  // dims: the `## Scorecard` table — first cell is the label, the first standalone 0–100
  // number in the row is its score. Weight/verdict columns pass through untouched.
  const dims: ReportDim[] = [];
  const scorecard = section(md, /^#{2,3}\s+scorecard\s*$/im);
  if (scorecard) {
    for (const line of scorecard.split('\n')) {
      const row = line.trim();
      if (!row.startsWith('|')) continue;
      const cells = row.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) continue;
      const label = cells[0]!.replace(/[*_`]/g, '').trim();
      if (!label || /^[-: ]+$/.test(label) || /^dimension/i.test(label)) continue;
      let dimScore: number | null = null;
      for (const c of cells.slice(1)) {
        const n = /^(\d{1,3})(?:\s*\/\s*100)?$/.exec(c.replace(/[*_`]/g, '').trim());
        if (n) { const v = Number(n[1]); if (v >= 0 && v <= 100) { dimScore = v; break; } }
      }
      if (dimScore !== null) dims.push({ label, score: dimScore });
    }
  }

  const fixes = section(md, /^#{2,3}\s+(?:fix|do)\s+these\s+first\s*$/im);
  const fixFirst = fixes
    ? (fixes.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) ?? fixes.match(/^#{3,4}\s+\S/gm) ?? []).length
    : 0;

  return { title, score, basis, dims: dims.slice(0, 8), fixFirst, gaps };
}

/** `‹report:artifactId›` — the wb/article marker anatomy, for host-posted reports. */
export interface ReportRef { id: string; prose: string; }
export function parseReportRef(body: string): ReportRef | null {
  const m = /‹report:([^‹›\s]+)›/.exec(body);
  if (!m) return null;
  return { id: m[1]!, prose: body.replace(/‹report:[^‹›]*›/g, '').trim() };
}

/** The card's basis line — one composer so every surface words it identically. */
export function reportFacts(r: ReportMeta): string {
  const parts: string[] = [];
  if (r.basis) parts.push(`basis: ${r.basis}`);
  parts.push('scores are heuristics, not measured performance');
  return parts.join(' · ');
}

// ── the trend (derived, never stored) ─────────────────────────────────────────────────────
// Re-runs of one playbook in one room form the series; like compares to like by the
// `playbook:` tag, ordered by created_at. The caller supplies parsed rows (it already holds
// the artifacts); this stays pure.

export interface ReportRun {
  id: string;
  created_at: string;
  score: number;
}

export interface ReportTrend {
  latest: ReportRun | null;
  /** latest minus previous — null on a first run (a first run wears no delta) */
  delta: number | null;
  prevAt: string | null;
  runs: ReportRun[]; // ascending by time, for sparklines
}

export function reportTrend(rows: readonly ReportRun[]): ReportTrend {
  const runs = [...rows].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const latest = runs[runs.length - 1] ?? null;
  const prev = runs[runs.length - 2] ?? null;
  return {
    latest,
    delta: latest && prev ? latest.score - prev.score : null,
    prevAt: prev?.created_at ?? null,
    runs,
  };
}
