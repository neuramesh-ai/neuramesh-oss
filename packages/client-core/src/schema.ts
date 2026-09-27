// the replica schema: the ONE table set every client opens PowerSync with (the desktop, the cloud
// machines, the web client and the phone). it moved here from apps/desktop/src/main/sync in phase
// 2.1 of the decoupling plan (docs/design/desktop-decoupling-2026-09/plan.md), so no client reads
// a file inside another app.
//
// the table set IS the sync contract: a table here that no sync rule serves stays empty forever,
// and a rule serving a table missing here has nowhere to land. both failures are silent. PowerSync
// drops any column the local schema does not declare, so an unmirrored column syncs to nothing.
// PowerSync has no boolean type: flags are integer (0/1).
//
// each client builds these tables with its OWN PowerSync SDK: @powersync/common is a peer
// dependency, so the desktop resolves its pinned copy and the phone the one react-native brings.
//
// what the phone reads beyond the room: `runs` (liveness is a synced row there, never local IPC),
// `decisions` (the answer cards) and `whiteboards` (snapshot_svg in cards, never a live canvas).
import { ColumnType, Schema } from '@powersync/common';
import { channel_members, channels, messages, threads } from './tables/rooms';
import { artifacts, beats, decisions, runs, tasks } from './tables/board';
import { agent_channels, agents, machines, policies, workspace_members } from './tables/crew';
import { code_sessions, connectors, content_items, schedules, skill_packs, skills, whiteboards } from './tables/content';
import { memory_blocks, project_repos, projects, repos } from './tables/infra';

export const TABLES = { channels, projects, messages, threads, tasks, machines, agents, agent_channels, repos, project_repos, artifacts, beats, runs, decisions, policies, memory_blocks, skills, skill_packs, schedules, content_items, connectors, workspace_members, channel_members, whiteboards, code_sessions };

export const AppSchema = new Schema(TABLES);

/** the table set as plain data (table → column → type), derived from the tables above: what a
 *  drift check or a contract snapshot reads without opening a database */
export const TABLE_COLUMNS: Record<string, Record<string, 'text' | 'integer'>> = Object.fromEntries(
  Object.entries(TABLES).map(([name, table]) => [
    name,
    Object.fromEntries(Object.entries(table.columnMap).map(([col, def]) => [col, def.type === ColumnType.INTEGER ? 'integer' : 'text'])),
  ]),
);
