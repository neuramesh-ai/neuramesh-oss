// The shared SQLite read-model contract, used by every client and the API change feed.
import { channel_members, channels, messages, threads } from './tables/rooms';
import { artifacts, beats, decisions, runs, tasks } from './tables/board';
import { agent_channels, agents, machines, policies, workspace_members } from './tables/crew';
import { code_sessions, connectors, content_items, reply_reminders, schedules, skill_packs, skills, whiteboards } from './tables/content';
import { memory_blocks, project_agents, project_repos, projects, repos } from './tables/infra';

export const TABLES = { channels, projects, project_agents, messages, threads, tasks, machines, agents, agent_channels, repos, project_repos, artifacts, beats, runs, decisions, policies, memory_blocks, skills, skill_packs, schedules, content_items, connectors, workspace_members, channel_members, whiteboards, code_sessions, reply_reminders };

export const AppSchema = { tables: Object.entries(TABLES).map(([name, table]) => ({ name, ...table })) };

/** the table set as plain data (table → column → type), derived from the tables above: what a
 *  drift check or a contract snapshot reads without opening a database */
export const TABLE_COLUMNS: Record<string, Record<string, 'text' | 'integer'>> = Object.fromEntries(
  Object.entries(TABLES).map(([name, table]) => [
    name,
    Object.fromEntries(Object.entries(table.columnMap).map(([col, def]) => [col, def.type])),
  ]),
);
