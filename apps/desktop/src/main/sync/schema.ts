// The replica schema PowerSync opens locally — extracted from sync.ts (track B-sync).
//
// The table set IS the sync contract: a table here that no sync rule serves stays empty
// forever, and a rule serving a table missing here has nowhere to land. Both failures are
// silent, which is why they get a parity test rather than a comment.
import { Schema } from '@powersync/common';
import { channel_members, channels, messages, threads } from './schema/rooms';
import { artifacts, beats, decisions, runs, tasks } from './schema/board';
import { agent_channels, agents, machines, policies, workspace_members } from './schema/crew';
import { code_sessions, connectors, content_items, schedules, skill_packs, skills, whiteboards } from './schema/content';
import { memory_blocks, project_repos, projects, repos } from './schema/infra';

export const AppSchema = new Schema({ channels, projects, messages, threads, tasks, machines, agents, agent_channels, repos, project_repos, artifacts, beats, runs, decisions, policies, memory_blocks, skills, skill_packs, schedules, content_items, connectors, workspace_members, channel_members, whiteboards, code_sessions });
export { agent_channels, agents, artifacts, beats, channel_members, channels, code_sessions, connectors, content_items, decisions, machines, memory_blocks, messages, policies, project_repos, projects, repos, runs, schedules, skill_packs, skills, tasks, threads, whiteboards, workspace_members };
