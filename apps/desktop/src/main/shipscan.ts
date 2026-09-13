// Ship-stage diff scanner (docs/23) — DETECTION is code; what a finding means for
// the release is the shipper's judgment (stall.ts / logoscan.ts idiom: pure, no
// electron imports, unit-testable). Findings map 1:1 onto the PR template's
// `## Deploy notes` rows — PowerSync / Vercel env / Migration / Desktop / Other —
// so the shipper's checklist starts from the same taxonomy the operator reads.

export type ShipFindingKind =
  | 'migration'        // a new supabase/migrations/*.sql (auto-applies on deploy — but data/backfill needs judgment)
  | 'env'              // a NEW env var referenced by added code (its prod value is a human step)
  | 'powersync'        // sync-rule/publication config touched (dashboard deploy is manual)
  | 'dependency'       // package.json deps changed (CI lockfile + native-module implications)
  | 'workflow'         // .github/workflows touched (CI/release behavior changes)
  | 'desktop_version'; // a desktop version bump rides this PR (tag/publish ritual follows)

export interface ShipFinding {
  kind: ShipFindingKind;
  detail: string; // one factual line, human-legible
}

export interface ShipScan {
  findings: ShipFinding[];
  /** deterministic floor for the plan's risk — the shipper may raise it, never lower it */
  riskHint: 'low' | 'medium' | 'high';
}

const MIGRATION_RE = /^\+\+\+ b\/(supabase\/migrations\/[\w.-]+\.sql)$/;
const POWERSYNC_RE = /^\+\+\+ b\/((?:dev\/stack\/)?powersync\/[\w./-]+|dev\/stack\/powersync\/[\w./-]+)$/;
const WORKFLOW_RE = /^\+\+\+ b\/(\.github\/workflows\/[\w.-]+)$/;
const PKG_RE = /^\+\+\+ b\/((?:[\w./-]+\/)?package\.json)$/;
const DESKTOP_PKG = 'apps/desktop/package.json';
// an ADDED line referencing an env var: process.env.X / process.env['X'] / import.meta.env.X
const ENV_ADD_RE = /^\+.*(?:process\.env(?:\.|\[')([A-Z][A-Z0-9_]{2,})(?:'\])?|import\.meta\.env\.([A-Z][A-Z0-9_]{2,}))/;
// vars that ship baked/local-only — referencing them is not a prod-env step
const ENV_IGNORE = new Set(['NODE_ENV', 'CI', 'HOME', 'PATH', 'NM_AGENT_MODE', 'NM_GH_FAKE', 'NM_USERDATA']);

/** Scan a unified diff for release-relevant changes. Pure string work — feed it
 * the task's nm-<N>.diff artifact. Unknown/binary hunks are simply not matched. */
export function scanDiff(diff: string): ShipScan {
  const findings: ShipFinding[] = [];
  const seen = new Set<string>();
  const add = (kind: ShipFindingKind, detail: string) => {
    const key = `${kind}:${detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ kind, detail });
  };

  let inNewFile = false; // between a `new file mode` marker and the next diff header
  let currentFile = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      inNewFile = false;
      currentFile = '';
      continue;
    }
    if (line.startsWith('new file mode')) inNewFile = true;

    const mig = MIGRATION_RE.exec(line);
    if (mig) {
      currentFile = mig[1]!;
      add('migration', `${inNewFile ? 'new migration' : 'migration touched'}: ${mig[1]}`);
      continue;
    }
    const ps = POWERSYNC_RE.exec(line);
    if (ps) {
      currentFile = ps[1]!;
      add('powersync', `sync-rule config touched: ${ps[1]} — the cloud dashboard mirror needs a manual Deploy`);
      continue;
    }
    const wf = WORKFLOW_RE.exec(line);
    if (wf) {
      currentFile = wf[1]!;
      add('workflow', `workflow touched: ${wf[1]}`);
      continue;
    }
    const pkg = PKG_RE.exec(line);
    if (pkg) {
      currentFile = pkg[1]!;
      continue;
    }

    if (currentFile.endsWith('package.json')) {
      if (/^\+\s*"version":/.test(line) && currentFile === DESKTOP_PKG) {
        add('desktop_version', 'apps/desktop version bumped — a vX.Y.Z tag → draft → publish ritual follows this merge (backend first, docs/11 §0)');
        continue;
      }
      if (/^\+\s*"[@\w][\w./-]*":\s*"/.test(line) && !/^\+\s*"(version|name|description|scripts|type|main|private)"/.test(line)) {
        add('dependency', `dependency line added in ${currentFile} — CI installs with a frozen lockfile; a native module needs the rebuild step`);
        continue;
      }
    }

    const env = ENV_ADD_RE.exec(line);
    if (env) {
      const name = (env[1] ?? env[2])!;
      if (!ENV_IGNORE.has(name)) add('env', `new env reference in added code: ${name} — its prod value must exist before this serves`);
    }
  }

  const kinds = new Set(findings.map((f) => f.kind));
  const manualEdges = ['env', 'powersync'].filter((k) => kinds.has(k as ShipFindingKind)).length;
  const riskHint: ShipScan['riskHint'] =
    manualEdges >= 2 || (manualEdges >= 1 && kinds.has('migration'))
      ? 'high'
      : kinds.size > 0
        ? 'medium'
        : 'low';
  return { findings, riskHint };
}

/** The scan as prompt-ready lines (empty string when clean). */
export function scanNote(scan: ShipScan): string {
  if (!scan.findings.length) return 'shipscan: clean — no migrations, env vars, sync-rule, dependency, or workflow changes detected in the diff.';
  return `shipscan findings (deterministic; judge what each means for the release):\n${scan.findings.map((f) => `- [${f.kind}] ${f.detail}`).join('\n')}`;
}
