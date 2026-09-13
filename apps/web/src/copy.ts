// Every string on the landing page, in page order (docs/designs/foundry-landing-fast-to-done.md).
// One file so the copy gate (landing-copy.test.ts) can read the page as a person does, and so a
// line changes in one place. ASD-STE100 throughout: no em dashes, no semicolons, active voice.

export const HQ_URL = 'https://hq.neuramesh.app';

// The iPhone app's listing (live, George 2026-09-08; the same id as the desktop's setup card and
// apps/mobile/eas.json ascAppId). The Download menu's iPhone row links only while this is set.
export const APP_STORE_URL: string | null = 'https://apps.apple.com/app/id6787487455';

export const HERO = {
  kicker: 'The fast way to run a company with agents',
  headline: ['From ask to done', 'in minutes.'],
  lead: 'Vetted expert agents on fast models finish real work: marketing drafts, research reports, routines, and pull requests. You approve what goes out. Invite your team when you want them in the room.',
  cta: 'Download for Mac',
  ctaPro: 'Get Pro',
  ctaSignedIn: 'Open your workspace',
  facts: ['Free on your Mac', 'Your keys', 'No limits', 'No account'],
  frame: { room: 'Local mode', task: 'a first run', url: 'This Mac · 127.0.0.1', alt: 'The desktop app on a first run: the local stack starts, the wizard connects a brain and names the workspace, the crew launches, and the shell opens on this Mac' },
};

export const DOWNLOAD_ROWS = {
  mac: { title: 'macOS', sub: 'The desktop app. The whole product, free on your Mac.', tag: 'DMG' },
  iphone: { title: 'iPhone', sub: 'The companion app. Follow the thread, tap Accept. Needs Pro.', tag: 'App Store' },
  iphonePending: { title: 'iPhone', sub: 'The companion app. In App Store review.', tag: 'Soon' },
  // the QR panel under the iPhone row, the desktop onboarding card's words
  qr: { scan: 'Scan with your phone camera', copy: 'Copy link', copied: 'Copied', open: 'Open App Store' },
};

export const PROOF = {
  kicker: 'Starts on a fast model',
  house: 'neuramesh Starter',
  houseTag: 'Pro',
  byos: ['Claude', 'OpenAI', 'Gemini'],
  line: 'Sign in to Claude, OpenAI, or Gemini on your Mac. A Pro workspace also starts on the neuramesh Starter model. neuramesh never marks up tokens.',
};

export type Cell = { n: string; title: string; body: string; tag: string };

// The philosophy, not the mechanics (George, 2026-09-08): why neuramesh bets on fast models. The
// review loop has its own section (04).
export const FAST = {
  n: '01', kicker: 'Why fast models',
  title: 'Most work does not need the biggest model.', titleMuted: 'It needs the fastest one.',
  lead: 'Drafts, reports, checks, and routines make up most of a company\'s day. A fast model finishes them in minutes, for a fraction of the cost.',
  cells: [
    { n: '01', title: 'Minutes, not hours', body: 'A fast model starts at once and finishes small work in minutes. You ask more, and you ask sooner.', tag: 'Speed' },
    { n: '02', title: 'Cheap enough to run all day', body: 'Routines, reports, and drafts on a fast model cost a fraction of a frontier model.', tag: 'Cost' },
    { n: '03', title: 'Big models when it matters', body: 'Sign in to your Claude, OpenAI, or Gemini subscription for the tasks that need more. Set one model per role.', tag: 'Your choice' },
  ] as Cell[],
};

export type Expert = { icon: 'search' | 'chat' | 'star' | 'mail' | 'bars' | 'code'; title: string; body: string };

export const EXPERTS = {
  n: '02', kicker: 'Vetted experts',
  title: 'Hire an expert with one command.', titleMuted: 'We test each one before it reaches you.',
  lead: 'Every expert is a tested agent with its own skills and playbook. It runs on a machine you own and reports in your room.',
  hire: 'Hire',
  cards: [
    { icon: 'search', title: 'Website audit', body: 'A scored audit, 0 to 100, with the fixes first and what it could not determine.' },
    { icon: 'chat', title: 'Social writer', body: 'Platform-native posts in your brand voice. They land on the calendar and hold for your approval.' },
    { icon: 'star', title: 'Launch planner', body: 'A launch plan from four weeks out to the week after, with the asset stack as subtasks.' },
    { icon: 'mail', title: 'Email sequences', body: 'Welcome, nurture, and launch sequences. We write them in full.' },
    { icon: 'bars', title: 'Positioning', body: 'A six-clause positioning statement. We test it and file it in your library.' },
    { icon: 'code', title: 'Code reviewer', body: 'Reviews every pull request against your definition of done and CI, before you see it.' },
  ] as Expert[],
  note: 'The first catalog is first-party. Every expert ships with its turnaround and its bench score.',
};

export const ROOMS = {
  n: '03', kicker: 'The rooms',
  title: '#build ships. #marketing tells the world.', titleMuted: 'Every room runs one kind of work.',
  lead: 'A room holds the people, the agents, the files, and the rules for one kind of work. An agent sees a room only when you register it there.',
  cells: [
    { n: '01', title: 'build', body: 'Plans, pull requests, reviews, and releases. Code reaches main only through your accept.', tag: 'Engineering' },
    { n: '02', title: 'marketing', body: 'Brand docs, posts, articles, and images on a calendar. Every draft holds until you approve it.', tag: 'Growth' },
    { n: '03', title: 'research', body: 'Audits, teardowns, and benchmarks that end in a scored report. It says what it could not determine.', tag: 'Research' },
    { n: '04', title: 'general', body: 'The room where you ask. rex routes each request to the right room and reports back every morning.', tag: 'The front door' },
  ] as Cell[],
};

export const LOOP = {
  n: '04', kicker: 'The loop',
  title: 'One agent gives you output.', titleMuted: 'A crew gives you something to approve.',
  lead: 'Two gates are yours: the plan, where the work is big, and the approval, always. Everything between them runs without you. This holds for a pull request, a campaign, and a post.',
  cells: [
    { n: '01', title: 'Ask', body: 'Type it in any room. Small work starts at once. Big work gets a plan you approve.', tag: 'Human gate' },
    { n: '02', title: 'Work', body: 'The crew works in the open. Every step, file, and screenshot lands in the thread.', tag: 'Evidence required' },
    { n: '03', title: 'Check', body: 'A different agent checks the result against your definition of done. No agent checks its own work.', tag: 'Server enforced' },
    { n: '04', title: 'Approve', body: 'Accept the pull request. Schedule the post. Approve the plan. Only a human can press these.', tag: 'Human only' },
  ] as Cell[],
  frame: { room: '#build', task: 'task #1046', url: 'hq.neuramesh.app/acme/build/1046', alt: 'The loop in the product: patch works on task 1046, scout reviews it, and the pull request waits on a human accept' },
};

export type Mate = { initial: string; name: string; role: string; status: string; on: boolean; tone: string };

export const CREW = {
  n: '05', kicker: 'The crew',
  title: 'The same named crew,', titleMuted: 'in every room.',
  lead: 'Most tools spawn a stranger per task and destroy it. neuramesh keeps one crew on your work. Review corrections become lessons they keep. Alone or with your team. Invite people into the rooms. On Pro, every member gets a cloud machine.',
  roster: [
    { initial: 'r', name: 'rex', role: 'Orchestrator', status: 'Morning digest for #build', on: true, tone: '#7d75d0' },
    { initial: 'a', name: 'atlas', role: 'Architect', status: 'Writes plan v2 for #1046', on: true, tone: '#8f80cf' },
    { initial: 'i', name: 'iris', role: 'Designer', status: 'Mockup round 2 for the pricing page', on: true, tone: '#c96fb0' },
    { initial: 'p', name: 'patch', role: 'Developer', status: 'Works #1046, PR #368 open', on: true, tone: '#4e9d78' },
    { initial: 's', name: 'scout', role: 'Reviewer', status: 'Reviews #1043', on: true, tone: '#5a8ac2' },
    { initial: 'm', name: 'plume', role: 'Marketer', status: 'Two X posts hold for your approval', on: true, tone: '#c9736a' },
    { initial: 'b', name: 'bosun', role: 'Shipper', status: 'Holds the ship gate', on: false, tone: '#4f9fb0' },
  ] as Mate[],
  hire: 'Hire a specialist. It joins over A2A.',
};

export const IN_EVERY_ROOM = {
  kicker: 'In every room',
  items: [
    { title: 'Whiteboards', body: 'Ask for a sketch. A board lands in the thread and opens as a canvas you can edit.' },
    { title: 'Routines', body: 'Say it once. It runs on a schedule and reports in the room.' },
    { title: 'Files', body: 'Brand docs, plans, and reports, one shelf per project. Agents read what you allow.' },
    { title: 'Brains', body: 'Pick a pack, or set one model per role. Bring your own subscriptions.' },
  ],
};

export type Perm = 'ok' | 'no' | 'lock';
export type PolicyRow = { agent: string; role: string; build: [Perm, string]; marketing: [Perm, string]; repo: [Perm, string] };

export const RULES = {
  n: '06', kicker: 'The rules',
  title: 'Rules the server enforces.', titleMuted: 'Not rules a prompt suggests.',
  lead: 'Every room carries a policy. An agent registered to #marketing never sees #build. Scope lives in the server, so no prompt can change it.',
  list: ['No agent checks its own work.', 'No submit without evidence.', 'One path to main: your accept.', 'Agents see a room only when you register them to it.'],
  matrix: {
    title: 'Workspace policy', tag: 'Enforced',
    head: ['Agent', '# build', '# marketing', 'repo · acme-app'],
    rows: [
      { agent: 'patch', role: 'developer', build: ['ok', '✓'], marketing: ['no', '·'], repo: ['ok', 'PR only'] },
      { agent: 'plume', role: 'marketer', build: ['no', '·'], marketing: ['ok', '✓'], repo: ['lock', 'locked'] },
      { agent: 'scout', role: 'reviewer', build: ['ok', '✓'], marketing: ['no', '·'], repo: ['ok', 'read'] },
      { agent: 'a2a guest', role: 'external specialist', build: ['lock', 'locked'], marketing: ['ok', 'invite'], repo: ['lock', 'locked'] },
    ] as PolicyRow[],
  },
};

export const SURFACES = {
  n: '07', kicker: 'Surfaces',
  title: 'Start on your Mac.', titleMuted: 'Pro adds the browser, the phone, and a cloud machine.',
  lead: 'Free runs the whole product on your Mac. On Pro, every member gets a cloud machine and the workspace opens at a URL. The phone follows the thread and can accept.',
  anchor: { kicker: 'On Pro, the browser is the workspace', title: 'The whole workspace, at a URL.', body: 'Board, threads, review, and Accept. Nothing to install. Your subscriptions sign in on a machine you own, never on ours.', url: 'hq.neuramesh.app/acme', alt: 'Home in the browser client: the rooms, the crew, and the morning composer' },
  cards: [
    { icon: 'laptop', title: 'Mac', body: 'The whole product, free. Your local repos and your own CLI logins, on your machine.' },
    { icon: 'phone', title: 'iPhone', body: 'Follow the thread, read the evidence, and tap Accept from anywhere.' },
    { icon: 'cloud', title: 'Cloud machine', body: 'Every Pro member gets one. It is outbound only. Your keys sign in on it, never on our servers.' },
  ] as Array<{ icon: 'laptop' | 'phone' | 'cloud'; title: string; body: string }>,
};

// Shared compute (docs/design/member-machines-2026-09/plan.md), in plain words (George,
// 2026-09-08: "this is marketing copy"). The mechanism stays true underneath: owners lend with one
// switch, the server checks the grant on every wake, and only the owner can open a machine. The
// landing does not say whose subscription a lent machine runs on.
export const COMPUTE = {
  n: '08', kicker: 'Shared compute',
  title: 'Share compute with your team.', titleMuted: 'One switch. No setup.',
  lead: 'Your Mac, your cloud machine, and your teammates\' machines work as one pool. Share yours with one switch. Use theirs when yours is busy.',
  cells: [
    { n: '01', title: 'One switch', body: 'Share your cloud machine with the team. Switch it off any time.', tag: 'You decide' },
    { n: '02', title: 'Private by default', body: 'Only you can open your machine. Teammates get their work done, not your keys.', tag: 'Yours' },
    { n: '03', title: 'No idle bill', body: 'Work runs on the machine that is free. A machine at rest costs nothing.', tag: 'Pay for use' },
  ] as Cell[],
};

// FREE IS YOUR MAC, PRO IS THE CLOUD (docs/design/oss-release-2026-09, D3 and artboard F): Free is
// the desktop app in Local mode, no account, no limits. Pro is the hosted cloud around it, $22 per
// seat per month. Ids stay free/cloud server-side. The Free card says the app sets up the local
// stack, so nobody meets the container runtime as a surprise after the download (review F3).
export const PRICING = {
  n: '09', kicker: 'Pricing',
  title: 'Free is your Mac.', titleMuted: 'Pro is the cloud.',
  lead: 'Bring your own Claude, OpenAI, or Gemini subscriptions. neuramesh never marks up tokens.',
  plans: [
    { name: 'Free', chip: 'Desktop', accent: false, price: '$0', per: '', tag: 'The whole product on your Mac.', feats: ['Every room, agent, and task on your machine', 'Your subscriptions and keys', 'No limits on projects, agents, or tasks', 'The app sets up a small local stack for you'], cta: 'Download for Mac', featured: false },
    { name: 'Pro', chip: 'Cloud', accent: true, price: '$22', per: 'per seat, per month', tag: 'The hosted cloud around it.', feats: ['Everything in Free', 'A cloud machine for every member', 'Invites, seats, and sync across devices', 'The browser app, the phone, and connectors that publish'], cta: 'Get Pro', featured: true },
  ],
};

export const CLOSE = {
  kicker: 'Ready when you are',
  title: 'Put your crew to work.',
  line: 'Free on your Mac. Pro when you want the cloud.',
  cta: 'Download for Mac',
};

// Source available, never open source (review F11): ELv2 is not an OSI license, and the line
// says exactly what it is. The url is the public repo the snapshot lands in (U6a).
export const FOOTER = {
  line: 'The fast way to run a company with agents.',
  legal: '© 2026 neuramesh · macOS · Windows soon',
  source: { line: 'Source available under the Elastic License 2.0', url: 'https://github.com/neuramesh-ai/neuramesh-oss' },
};

export const NAV = {
  links: [['#fast', 'Product'], ['#experts', 'Experts'], ['#pricing', 'Pricing']] as Array<[string, string]>,
  signin: 'Sign in',
  start: 'Download',
  open: 'Open workspace',
};
