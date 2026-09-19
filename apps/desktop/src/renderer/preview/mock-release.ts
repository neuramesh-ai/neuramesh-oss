// THE RELEASE SESSION (docs/design/release-drafts-2026-09, board B): the fixture world for one
// shipped feature — the routine's digest as the owner's first message, the unit card, the brief and
// its four drafts. Kept apart from mock-fixtures.ts (at its size cap) and spliced in there, so this
// file must import nothing from it. Rows only: the bridge that serves them is mock-nm.ts.
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
// the routine fired at 09:00, three hours ago: the ledger row in mock-doors.ts (th-rel-134) names this session
const FIRED = 3 * 60 * MIN;

export const RELEASE_THREAD_ID = 'th-rel-134';
/** the armed routine's id — mock-doors.ts seeds the schedule row itself (its cursor and ledger); this file only names it */
export const RELEASE_SCHEDULE_ID = 'sch-mk-release';
// uuid-shaped on purpose: the ‹task:id› and ‹brief:id› parsers accept nothing shorter
export const RELEASE_UNIT_ID = 'aaaaaaa3-3333-4333-8333-333333331142';
export const RELEASE_BRIEF_ID = 'aaaaaaa4-4444-4444-8444-444444440134';

// the tick's digest (shared releaseDigest): the session title line, what is new, the marker
const DIGEST = [
  'v0.134.0: the browser terminal',
  '**Release drafts · neuramesh-ai/neuramesh-oss** · new since v0.133.0 · checked 09:00',
  '- **v0.134.0** · published Sep 16 · *The browser terminal: a shell on your cloud machine from any browser. The machine never listens. nm-relay is the rendezvous both sides dial out to.*',
  '- 5 merged: #385 nm-relay · #387 the terminal pane · #390 relay health checks · #391 fix: pty bytes · #392 chore: deps',
  '‹release:neuramesh-ai/neuramesh-oss@v0.134.0›',
].join('\n');

// the brief (shared releasebrief.ts's contract): the head, the verdict line, the honesty section
const BRIEF = `# Release brief · v0.134.0
Verdict: feature · Basis: release notes, 5 merged pull requests, README

## Why
The browser terminal: a shell on your cloud machine from any browser.
The release notes lead with it. Three of the five merged pull requests build it (#385, #387, #390). #391 is a fix and #392 is a chore, so neither is announced.

## Audience
Engineers who run agents on a cloud machine and sign in to vendors from it.

## Assets
A release card on the brand palette for Instagram and TikTok. No screenshot: the profile has no site to capture.

## What I could not determine
The date #390 merged. The notes name it, the log does not.
`;

// the release card the drafts carry, as the image lane would draw it: the version, the feature, the mark, on graphite
const THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="#141414"/><rect x="40" y="40" width="560" height="560" rx="14" fill="none" stroke="#2c2c2c" stroke-width="2"/><rect x="88" y="96" width="40" height="40" rx="8" fill="#834a2b"/><rect x="100" y="108" width="16" height="16" rx="3" fill="#fff7ee"/><text x="88" y="300" font-family="Menlo, monospace" font-size="30" fill="#8a8a8a">v0.134.0</text><text x="88" y="366" font-family="-apple-system, Helvetica, sans-serif" font-size="50" font-weight="500" fill="#e8e6e3">The browser</text><text x="88" y="426" font-family="-apple-system, Helvetica, sans-serif" font-size="50" font-weight="500" fill="#e8e6e3">terminal</text><text x="88" y="540" font-family="Menlo, monospace" font-size="20" fill="#6a6a6a">neuramesh.app/source</text></svg>')}`;

export const releaseSchedule = {
  id: RELEASE_SCHEDULE_ID, channelId: 'c-marketing', title: 'Release drafts · neuramesh-oss',
  prompt: 'Check neuramesh-ai/neuramesh-oss for releases since the last run. When a feature shipped, run the release announcement playbook for every connected account.',
  cadence: 'daily', at_time: '09:00', tz: 'America/Vancouver', weekday: null, next_run_at: new Date(Date.now() + 14 * 3600e3).toISOString(), status: 'active', run_count: 3,
};

export const releaseThread: any = {
  id: RELEASE_THREAD_ID, title: 'v0.134.0: the browser terminal', description: '', created_by: 'human:u-george', task_id: null,
  schedule_id: RELEASE_SCHEDULE_ID, created_at: ago(FIRED), updated_at: ago(FIRED - 7 * MIN), msg_count: 5,
  last_body: 'The brief is in.', last_author_kind: 'agent', last_at: ago(FIRED - 7 * MIN),
};

// the transcript, in the host's order (main/host/leanunits.ts): the digest, rex's unit card, plume's
// hand-over, the completion note in the coordinator's voice, then the brief's card a beat later
export const releaseMsgs: any[] = [
  { id: 'rl1', author_kind: 'human', author_id: 'u-george', created_at: ago(FIRED), body: DIGEST },
  { id: 'rl2', author_kind: 'agent', author_id: 'a-rex', created_at: ago(FIRED - MIN), body: `A feature shipped in v0.134.0, the browser terminal. I started the release announcement playbook for plume. ‹task:${RELEASE_UNIT_ID}›` },
  { id: 'rl3', author_kind: 'agent', author_id: 'a-plume', created_at: ago(FIRED - 6 * MIN - 30_000), body: 'Done. The brief and four drafts are below, one per connected account.' },
  { id: 'rl4', author_kind: 'agent', author_id: 'a-rex', created_at: ago(FIRED - 7 * MIN + 10_000), body: '✅ **#1142 is done** — `release-report-2026-09-17.md` delivered. Review it on the card and accept when it looks right.' },
  { id: 'rl5', author_kind: 'agent', author_id: 'a-rex', created_at: ago(FIRED - 7 * MIN), body: `The brief is in. ‹brief:${RELEASE_BRIEF_ID}›` },
];

export const releaseUnit: any = {
  id: RELEASE_UNIT_ID, number: 1142, title: 'Release drafts · v0.134.0', kind: 'content',
  description: 'Playbook: release (marketing-os). Announce v0.134.0, the browser terminal: the brief with a verdict, then one post per connected account, with an image brief where a network needs one.',
  state: 'done', assignee_kind: 'agent', assignee_id: 'a-plume', offered_agent_id: null,
  requirements: '["the brief with a verdict","one post per connected account","an image brief where a network needs one"]', requirements_confirmed: 1,
  definition_of_done: '- The brief, with a verdict and the gaps named\n- One post per connected account\n- An image brief where the network needs one',
  project_id: 'p-acme', channel_id: 'c-marketing', branch: null, repo_id: null, submitted_sha: null, pr_url: '', pr_number: null, artifact_count: 1,
  parent_task_id: null, origin_thread_id: RELEASE_THREAD_ID,
  work_plan: JSON.stringify({ legs: ['build'], subtasks: [], approach: 'Read the release and its merged pull requests, decide the verdict, write the brief, then draft one post per connected account.', version: 1, proposedAt: ago(FIRED - MIN) }),
  plan_approved_at: ago(FIRED - MIN), created_at: ago(FIRED - MIN), updated_at: ago(FIRED - 7 * MIN + 10_000), claimed_at: ago(FIRED - 2 * MIN), submitted_at: null, approved_at: null, accepted_at: null, closed_at: null,
};

// the unit's sole markdown deliverable: what the ‹brief:id› card reads
export const releaseBriefArt: any = {
  id: RELEASE_BRIEF_ID, kind: 'file', name: 'release-report-2026-09-17.md', mime: 'text/markdown', inline_content: BRIEF, size_bytes: BRIEF.length,
  promoted: 0, message_id: 'rl4', task_id: RELEASE_UNIT_ID, channel_id: 'c-marketing', channel_slug: 'marketing', created_at: ago(FIRED - 7 * MIN + 5_000),
};

// one post per connected account (board B's DRAFTS): the two that need no picture, the two that carry the release card.
// Letters follow birth order (postCardsFrom), and `ago` counts BACK from now: a larger offset is the older row
const LANDED = FIRED - 6 * MIN - 20_000;
export const releaseItems: any[] = [
  { id: 'ci-r1', channelId: 'c-marketing', task_id: RELEASE_UNIT_ID, platform: 'x', body: 'v0.134.0 is out. You can now open a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins like gh auth login finish on a machine you own.', status: 'draft', scheduled_at: null, published_at: null, external_url: null, created_at: ago(LANDED + 3_000), schedule_id: null, media: null },
  { id: 'ci-r2', channelId: 'c-marketing', task_id: RELEASE_UNIT_ID, platform: 'linkedin', body: 'NeuraMesh v0.134.0 adds a browser terminal.\n\nOpen a shell on your cloud machine from any browser. The machine never listens. It dials out to a relay, and your browser does the same. Vendor logins finish on a machine you own.\n\nRelease notes: github.com/neuramesh-ai/neuramesh-oss/releases', status: 'draft', scheduled_at: null, published_at: null, external_url: null, created_at: ago(LANDED + 2_000), schedule_id: null, media: null },
  { id: 'ci-r3', channelId: 'c-marketing', task_id: RELEASE_UNIT_ID, platform: 'instagram', body: 'A shell on your cloud machine, from any browser. v0.134.0 is out.', status: 'draft', scheduled_at: null, published_at: null, external_url: null, created_at: ago(LANDED + 1_000), schedule_id: null, media: JSON.stringify({ brief: 'the release card: the version, the feature name, the oak mark, on graphite. No other text.', thumb: THUMB }) },
  { id: 'ci-r4', channelId: 'c-marketing', task_id: RELEASE_UNIT_ID, platform: 'tiktok', body: 'Open a terminal on your cloud machine from your phone. v0.134.0.', status: 'draft', scheduled_at: null, published_at: null, external_url: null, created_at: ago(LANDED), schedule_id: null, media: JSON.stringify({ thumb: THUMB }) },
];

/** the one splice mock-fixtures.ts makes: mutation, never reassignment, so its exported consts stay the
 *  bindings every other module holds. Runs before allTasks derives from tasksByChannel. */
export function spliceRelease(w: { mockThreads: Record<string, any[]>; convoMsgs: Record<string, any[]>; mockContentItems: any[]; mockSchedules: any[]; tasksByChannel: Record<string, any[]> }): void {
  (w.mockThreads['c-marketing'] ??= []).push(releaseThread);
  w.convoMsgs[RELEASE_THREAD_ID] = releaseMsgs;
  w.mockContentItems.push(...releaseItems);
  if (!w.mockSchedules.some((x) => x.id === RELEASE_SCHEDULE_ID)) w.mockSchedules.push(releaseSchedule); // mock-doors.ts seeds it first
  (w.tasksByChannel['c-marketing'] ??= []).push(releaseUnit);
}
