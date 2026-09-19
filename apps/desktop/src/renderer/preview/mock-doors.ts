// The release-drafts doors (docs/design/release-drafts-2026-09 §4.7) as fixtures: the marketing
// room that stopped after step 4, so the wizard resumes on step 5; its project's repository; and
// the armed release routine with its ledger. A file of its own because mock-fixtures.ts stands
// eight counted lines under its size cap — mock-fixtures re-exports these, so the mock bridge
// still reads one world. Nothing here imports mock-fixtures (that would be a circular import).
const H = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const DOOR_PROJECT_ID = 'p-flowe';
export const DOOR_CHANNEL_ID = 'cf-marketing';
export const DOOR_SETUP_TASK_ID = 'tk-1070';

// the profile after step 4: every earlier step wrote as it landed, and the marker rests on
// `connect`, so setupProgress() answers `next: 'releases'` and the card lands there
export const DOOR_MARKETING_PROFILE = JSON.stringify({
  website: 'flowe.app', goal: 'first 1000 signups', focus: ['social', 'content'],
  setup_progress: { flow: 'marketing.v1', step: 'connect' },
});

// the setup task (docs/39): kind='setup', open, so its thread mounts the wizard — a bare task
// (no linked thread), which the rail lists as a task row the ?openTask= driver can click
export const DOOR_TASKS = [
  { id: DOOR_SETUP_TASK_ID, number: 1070, title: 'Set up your marketing HQ', kind: 'setup', description: '', state: 'in_progress', assignee_kind: null, assignee_id: null, offered_agent_id: null, requirements: null, requirements_confirmed: 0, definition_of_done: null, project_id: DOOR_PROJECT_ID, channel_id: DOOR_CHANNEL_ID, branch: null, repo_id: null, submitted_sha: null, pr_url: '', pr_number: null, artifact_count: 0 },
];

// the project's repository, primary to it — what step 5 shows as the chip (RepoUI, rows-board.ts)
export const DOOR_REPOS = [
  { id: 'r-oss', provider: 'github', org_name: 'neuramesh-ai', name: 'neuramesh-oss', default_branch: 'main', local_path: null, project_ids: DOOR_PROJECT_ID, primary_project_ids: DOOR_PROJECT_ID },
];

// the armed release routine (releasescan.ts ReleasePayload): the cursor, and the ledger the
// Routines panel reads — a fired day (its session is a run row), a quiet day (no session, so the
// ledger line is the only trace), and an older fired day
const RELEASE_ASK = 'Run the release drafts playbook.';
export const DOOR_RELEASE_SCHEDULE = {
  id: 'sch-mk-release', channelId: 'c-marketing', title: 'Release drafts · neuramesh-oss', prompt: RELEASE_ASK,
  cadence: 'daily', at_time: '09:00', tz: 'America/Vancouver', weekday: null, next_run_at: ago(-21 * H), status: 'active', run_count: 3,
  payload: JSON.stringify({ prompt: RELEASE_ASK, routine: true, release: {
    repo: 'r-oss', slug: 'neuramesh-ai/neuramesh-oss', cursor: { at: ago(3 * H), tag: 'v0.133.0' },
    log: [
      { at: ago(51 * H), key: 'v0.133.0', note: 'v0.133.0 · 1 release · 3 merged' },
      { at: ago(27 * H), key: null, note: 'nothing new since v0.133.0' },
      { at: ago(3 * H), key: 'v0.134.0', note: 'v0.134.0 · 1 release · 5 merged' },
    ],
  } }),
};

// the two sessions the routine opened (0119) — titled once from the feature, so the tag is the row
export const DOOR_SCHEDULE_RUNS: Record<string, Array<{ id: string; title: string; last_body: string; created_at: string; updated_at: string; channel_id: string; channel_slug: string; msg_count: number }>> = {
  'sch-mk-release': [
    { id: 'th-rel-134', title: 'v0.134.0: the browser terminal', last_body: 'Done. The brief and four drafts are below, one per connected account.', created_at: ago(3 * H), updated_at: ago(3 * H - 7 * 60_000), channel_id: 'c-marketing', channel_slug: 'marketing', msg_count: 3 },
    { id: 'th-rel-133', title: 'v0.133.0: open source', last_body: 'Three posts published. One draft waits for a picture.', created_at: ago(51 * H), updated_at: ago(40 * H), channel_id: 'c-marketing', channel_slug: 'marketing', msg_count: 6 },
  ],
};
