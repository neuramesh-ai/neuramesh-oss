// Replica tables: projects, repos, project_repos, memory_blocks — extracted from sync.ts (track B-sync).
//
// Grouped the same way the renderer groups its row TYPES (bridge/rows-*), so a domain
// reads the same on both sides of the IPC boundary. A column added here needs the
// matching client-core mirror and a sync rule — the parity test is the tripwire.
import { column, Table } from '@powersync/common';

export const projects = new Table({ workspace_id: column.text, channel_id: column.text, slug: column.text, name: column.text, description: column.text, status: column.text, is_default: column.integer, auto_open_pr: column.integer, run_ci_before_merge: column.integer, ship_gate: column.integer, website: column.text, logo_url: column.text, model_pack: column.text });

export const repos = new Table({
  workspace_id: column.text,
  provider: column.text,
  org_name: column.text,
  name: column.text,
  default_branch: column.text,
  clone_url: column.text,
  local_path: column.text,
});

// the repo→project link (0106/0107). Without it the replica cannot tell whose checkout a repo
// is, so every project-scoped repo question had to guess — see nm:channel-meta.
export const project_repos = new Table({
  project_id: column.text,
  repo_id: column.text,
  is_primary: column.integer,
});

export const memory_blocks = new Table({
  workspace_id: column.text,
  channel_id: column.text,
  project_id: column.text,
  kind: column.text,
  content: column.text,
  basis_count: column.integer,
  updated_at: column.text,
});
