// The fifteen screens. Each returns the inside of one 390×844 phone; the theme is the column's
// class, so one source renders graphite dark and cream oak by construction (docs/33 §1: a surface
// that only looks right in one theme is a bug). Copy is real product copy, read aloud once; data
// is SAMPLE data (workspace `neuramesh`, George, teammates Ada and Ben, agents rex · patch · iris ·
// quill), labeled as such in the vocabulary sheet.
import { ic, porch, orb, credring, av, head, shead, tok, tabbar, kick, chip, dial, srow, card, qcard, hb, am, liveLine, unit, att, cchip, brainpill, composer, mpop, scope, segs, btn } from './ui.mjs';

const safe = '<div class="safe"></div>';
const homebar = '<div class="homebar"></div>';
const body = (inner, style = '', cls = '') => `<div class="body${cls ? ` ${cls}` : ''}"${style ? ` style="${style}"` : ''}>${inner}</div>`;
const fab = `<span class="fab">${ic('compose', 22)}</span>`;
const pmode = (on) => `<span class="pmode"><span${on === 'Plan' ? ' class="on"' : ''}>Plan</span><span${on === 'Act' ? ' class="on"' : ''}>Act</span></span>`;
const clipChip = cchip('clip', '', { iconOnly: true, caret: false });

const MACHINE_ROWS = [
  { icon: 'auto', name: 'Auto', sub: 'cloud when awake', on: true },
  { icon: 'cloud', name: 'george-cloud', st: 'on', tag: 'auto' },
  { icon: 'cloud', name: 'Cloud', st: 'sleep' },
  { icon: 'cloud', name: 'ada-cloud', sub: 'Ada', st: 'sleep' },
  { icon: 'machine', name: 'george-mbp', st: 'off', off: true },
];

export const SCREENS = [
  {
    id: 'SignIn', title: '1 · Welcome — start free or sign in',
    note: 'The first screen of a fresh install now says the cloud-first offer: sign up here and a cloud machine comes with your workspace, nothing to install. Both verbs open the same Clerk page the desktop hands off to, in Safari, and return here — zero new auth surface. Start free is the decisive action.',
    html: () => `${safe}
${body(`
  <div class="tile">${porch(52)}</div>
  <div class="wm" style="margin-top:22px">neuramesh</div>
  <div class="sub" style="margin-top:8px;font-size:14px;max-width:290px">Your people. Your agents. Your projects.</div>
  <div class="dim" style="font-size:12.5px;margin-top:10px;line-height:1.45;max-width:300px">Sign up and a cloud machine comes with your workspace. Nothing to install.</div>
  <span class="btn primary" style="margin-top:28px;width:100%;min-height:48px;font-size:15px">Start free</span>
  <span class="btn" style="margin-top:8px;width:100%;min-height:44px;font-size:14px">Sign in</span>
  <div class="dim" style="font-size:11.5px;margin-top:14px;line-height:1.45;max-width:300px">Both open neuramesh.app in Safari and return here.</div>
`, 'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 28px;text-align:center')}
<div class="mono dim" style="font-size:10.5px;letter-spacing:.08em;text-align:center;padding-bottom:30px">your compute · cloud truth</div>`,
  },
  {
    id: 'Arrival', title: '2 · Arrival — your cloud machine',
    note: 'The first Home after sign-in. The head carries the workspace and the machine facts (the cloud-machine pill in its state colour, the credit ring). A wake is the pane-scoped boot card from the autowake round — one state at a time, no progress bar — pinned where the room brief lives; leaving keeps it coming. The queue rests as one line.',
    html: () => `${safe}${head({ pill: 'waking' })}
${body(`
  ${kick('Needs you', 2, `#1046 ready to accept ${ic('chevronR', 12)}`)}
  <div class="boot">${orb(64)}<h3>Starting your cloud machine</h3><div class="sub"><b>0:42</b> · usually about 2 minutes</div><div class="q">Agents pick their work back up automatically</div><div class="dim" style="font-size:11px;margin-top:6px">You tapped Wake now · leaving keeps it coming</div></div>
  ${kick('Today')}
  ${srow({ kind: 'task', state: 'in_progress', title: '#1061 · Relay backend timeout guard', snip: 'patch · waiting for george-cloud', when: '#build' })}
  ${srow({ kind: 'chat', title: 'Where do vendor logins live on a member machine?', snip: 'you → rex · "on the member’s own volume…"', when: '#general' })}
  ${srow({ kind: 'routine', title: 'Daily brief · Tue 09:00', snip: 'rex · 3 items moved, 1 needs you', when: '#marketing' })}
  ${kick('Yesterday')}
  ${srow({ kind: 'task', state: 'accepted', title: '#1052 · X token rotation fix', snip: 'accepted · squash-merged to main', when: '#build' })}
`)}
${fab}${tabbar('Home')}`,
  },
  {
    id: 'Main', title: '3 · Home',
    note: 'Home = the needs-you queue (cards keep their buttons: Accept clears done, a question clears by answering) + the session list, day-grouped, one row anatomy for everything: a task wears its dial, a chat the speech glyph, a Code session the prompt glyph, a routine’s run the clock; an open run swaps the glyph for the orb; a question waiting on you pulses at the trailing edge. New chat is the FAB.',
    html: () => `${safe}${head({ pill: 'online' })}
${body(`
  ${kick('Needs you', 2, `fold ${ic('chevron', 12)}`)}
  ${card(`<div class="qk">ready to accept · #1046</div><div class="qh">iOS Safari focus-trap release</div><div class="sub">passed review · patch · PR #431 · CI green</div><div class="btnrow">${btn('Accept and merge', 'primary sm')}${btn('Request changes', 'sm')}</div>`)}
  ${qcard({ kicker: 'question · rex in #general', q: 'Which room should the daily brief post to?', opts: ['#general', '#marketing'], field: null })}
  ${kick('Today')}
  ${srow({ kind: 'task', state: 'in_progress', live: true, title: '#1061 · Relay backend timeout guard', snip: 'patch · writing the GCPBackendPolicy test · 2/5', when: '#build' })}
  ${srow({ kind: 'chat', title: 'Where do vendor logins live on a member machine?', snip: 'you → rex · "on the member’s own volume…"', when: '#general' })}
  ${srow({ kind: 'code', title: 'Add threadOrigin to mobile sends', snip: '⎇ nm/engineering/george/mobile-origin', snipMono: true, when: 'neuramesh', chipText: 'act', chipCls: 'act' })}
  ${srow({ kind: 'routine', title: 'Daily brief · Tue 09:00', snip: 'rex · 3 items moved, 1 needs you', when: '#marketing', ask: true })}
  ${kick('Yesterday')}
  ${srow({ kind: 'task', state: 'accepted', title: '#1052 · X token rotation fix', snip: 'accepted · squash-merged to main', when: '#build' })}
  ${srow({ kind: 'chat', title: 'Draft the Team pricing email', snip: 'quill → you · "two cards, Individual and Team"', when: '#marketing' })}
`)}
${fab}${tabbar('Home')}`,
  },
  {
    id: 'NewChat', title: '4 · New chat — the machine chip',
    note: 'The New chat stage: the serif greeting whose project name is the switcher, ghost suggestion pills, THE composer with its three knobs — room chip · brain pill · machine chip. The chip’s popover is the desktop recipe: Auto first with what it resolves to, then icon · name (a teammate’s adds their name), the state as an icon, the row Auto resolves to tagged, one foot line. A phone session prefers the cloud; "This Mac" never appears.',
    html: () => `${safe}${shead({ crumb: 'home' })}
${body(`
  <div class="pad" style="margin-top:34px"><div class="serif" style="font-size:24px">Good evening, George.<br>What’s next in <span class="ital">neuramesh</span>?</div></div>
  <div class="vg" style="margin-top:16px"><span class="pill">What moved while I was away?</span><span class="pill">Plan the next release</span><span class="pill">Give me ideas</span></div>
`)}
${mpop({ rows: MACHINE_ROWS, foot: '<b>Phone sessions prefer the cloud</b> · pick a machine for this one' }).replace('class="pop"', 'class="pop" style="bottom:150px"')}
${composer({ placeholder: 'Message #general…', chips: [cchip('hash', 'general'), brainpill(), cchip('cloud', 'george-cloud', { open: true }), clipChip], note: '<b>rex</b> picks it up in #general · runs on george-cloud' })}
${homebar}`,
  },
  {
    id: 'Thread', title: '5 · A thread',
    note: 'One session anatomy (docs/35): crumb · title · toks (the chat chip, the machine the session was born on — settled at birth, never a chip in a thread’s composer — the crew). The human keeps the hairline bubble; agent prose runs on the ground; a question card is the one elevated object in a message (ghost pills, the composer recipe for the free answer); the unit card is a line, not a card; attachments render inline; the reply-to card arms the composer.',
    html: () => `${safe}${shead({ crumb: '#general · conversations', title: 'Where do vendor logins live on a member machine?', toks: [chip('chat', 'chat'), tok(`${ic('cloud', 12)}george-cloud`), tok(`${ic('agents', 12)}rex · patch`)] })}
${body(`<div class="msgs">
  ${hb('Where do vendor logins live on a member machine?')}
  ${am({ who: 'rex', role: 'orchestrator', time: '9:41', prose: 'On the member’s own volume — <code>/nm/home</code> on your cloud machine. You sign in through the vendor’s own flow in a terminal there; the platform never sees the token.', extra: att('relay-attach.png', '1.2 MB · screenshot') + qcard({ q: 'Which room should the daily brief post to?', opts: ['#general', '#marketing'], picked: '#marketing' }) })}
  ${am({ who: 'rex', role: 'orchestrator', time: '9:44', prose: '#marketing it is. Filed — the plan is yours to approve:', extra: unit({ n: 1057, title: 'Daily brief in #marketing', state: 'plan_review', go: 'Approve plan' }) })}
  <div class="pad">${liveLine('patch', 'reading the relay attach code · 2/5')}</div>
</div>`)}
${composer({ placeholder: 'Reply…', reply: { who: 'rex', text: 'Which room should the daily brief…' }, chips: [clipChip] })}
${homebar}`,
  },
  {
    id: 'History', title: '6 · History — search every thread',
    note: 'The ⌘Y everything-lens as a phone screen, opened from the head’s magnifier: the one search field in the product, a project narrowing you can see, the count, and the same rows Home draws. A Code session is a row here too.',
    html: () => `${safe}${shead({ crumb: 'home' })}
${body(`
  <div class="field">${ic('search', 16)}<span class="ink" style="flex:1">focus trap</span><span class="x">${ic('close', 14)}</span></div>
  <div class="vg" style="margin-top:8px"><span class="pill">All projects</span><span class="pill on">${ic('project', 12)} neuramesh</span><span class="pill">flowe</span></div>
  ${kick('4 threads')}
  ${srow({ kind: 'task', state: 'done', title: '#1046 · iOS Safari focus-trap release', snip: 'passed review · patch · PR #431', when: '#build · 2d' })}
  ${srow({ kind: 'chat', title: 'Focus trap on the roster popover', snip: 'you → rex · "the inert backdrop swallows Tab"', when: '#general · 5d' })}
  ${srow({ kind: 'code', title: 'Release the focus trap when the popover unmounts', snip: '⎇ nm/engineering/george/focus-trap', snipMono: true, when: 'neuramesh · 6d', chipText: 'done', chipCls: 'done' })}
  ${srow({ kind: 'task', state: 'accepted', title: '#988 · Modal focus order audit', snip: 'accepted · Jul 12', when: '#build · 8w' })}
`)}
${homebar}`,
  },
  {
    id: 'Code', title: '7 · Code — the list of Code threads',
    note: 'The Code tab is the rail’s Code mode: code work only, the branch as each row’s one fact, scope by repo. The state is the row’s glyph: the orb for a streaming turn, the accent pulse for an approval waiting on you, a quiet row for a resting Plan, the check for done. New session is the FAB.',
    html: () => `${safe}${head({ pill: 'online' })}
${body(`
  ${scope('All repos')}
  ${kick('Today')}
  ${srow({ kind: 'code', live: true, title: 'Add threadOrigin to mobile sends', snip: '⎇ nm/engineering/george/mobile-origin', snipMono: true, when: '2m', chipText: 'act', chipCls: 'act' })}
  ${srow({ kind: 'code', ask: true, title: 'Relay attach for the phone', snip: '⎇ nm/engineering/george/relay-phone', snipMono: true, when: '14m', chipText: 'approval', chipCls: 'approval' })}
  ${srow({ kind: 'code', title: 'Explain the sleeper rung', snip: 'neuramesh · read-only', when: '1h', chipText: 'plan', chipCls: 'plan' })}
  ${kick('Yesterday')}
  ${srow({ kind: 'code', title: 'Machine chip on the New chat stage', snip: '⎇ nm/engineering/george/machine-chip · PR #431', snipMono: true, when: '1d', chipText: 'done', chipCls: 'done' })}
  ${srow({ kind: 'code', title: 'Why does the bundle bot move the head SHA?', snip: 'flowe · read-only', when: '1d', chipText: 'plan', chipCls: 'plan' })}
  ${kick('This week')}
  ${srow({ kind: 'code', title: 'Berth sweep on a member machine', snip: '⎇ nm/engineering/george/berth-sweep · PR #419', snipMono: true, when: '4d', chipText: 'done', chipCls: 'done' })}
`)}
${fab}${tabbar('Code')}`,
  },
  {
    id: 'CodeThread', title: '8 · A Code thread',
    note: 'Conversation first, evidence a segment away (the phone-width rule from the Engineering OS: explicit controls, never gesture-only). Reasoning folds into one disclosure, tool receipts fold into rows, the approval card shows the whole patch before anything is applied and is the one elevated object; Plan|Act and the three chips (project · model · machine, icons only at this width) live in the composer’s control row. Decisive actions ride the brand pair.',
    html: () => `${safe}${shead({ crumb: 'code', title: 'Relay attach for the phone', toks: [tok(`${ic('branch', 12)}nm/engineering/george/relay-phone`), tok(`${ic('cloud', 12)}george-cloud`)] })}
<div class="evid"><span class="on">Transcript</span><span>Changes <i>3</i></span><span>Checkpoints <i>2</i></span><span>Plan</span></div>
${body(`<div class="msgs">
  ${hb('Reuse relay-client.ts for the phone: one socket per app, the engineering lane, bytes not strings.')}
  <div class="think">${ic('chevronR', 12)} Thought for 12s</div>
  <div class="rr"><span class="w">${ic('check', 12)}</span><b>Read 4 files</b><span class="n">2s</span></div>
  <div class="rr"><span class="w">${ic('check', 12)}</span><b>Searched openRelayJsonChannel</b><span class="n">1s</span></div>
  <div class="pad"><div class="ap">The browser edge already multiplexes terminals and the engineering lane over one socket. I’ll add a <code>RelayEnv</code> for Expo (bearer + workspace from the session), keep one streaming decoder per channel, and route the attach through the same validator.</div></div>
  ${card(`<div class="qk">approval · edit files</div><div class="qh">Apply patch · 3 files</div><div class="facts">apps/mobile/src/relay.ts &nbsp;+118<br>apps/mobile/src/relay-frames.ts &nbsp;+2<br>apps/mobile/package.json &nbsp;+1</div><div class="btnrow">${btn('Approve', 'primary sm')}${btn('Deny', 'sm')}</div><div class="dim" style="font-size:11px;margin-top:8px">then verify: <span class="mono">pnpm typecheck</span> — asks first</div>`)}
</div>`)}
${composer({ placeholder: 'Reply or redirect…', chips: [pmode('Act'), cchip('project', '', { iconOnly: true }), cchip('brain', '', { iconOnly: true }), cchip('cloud', '', { iconOnly: true })], note: '<b>Act</b> · edits ask first · commands ask first' })}
${homebar}`,
  },
  {
    id: 'NewCode', title: '9 · New Code session',
    note: 'The Code landing, as a phone: the mark, "What can I do for you?", the real composer with Plan|Act, the project chip (fixes the repo and the inherited model), the model chip (Project default, named once resolved), the machine chip (the cloud machine that hosts the worktree and the branch), then recents. Healthy connectivity is invisible.',
    html: () => `${safe}${shead({ crumb: 'code' })}
${body(`
  <div style="display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:22px">${porch(40)}<div class="serif" style="font-size:22px">What can I do for you?</div></div>
  <div style="margin-top:10px">${composer({ placeholder: 'Describe the change…', chips: [pmode('Plan'), cchip('project', '', { iconOnly: true }), cchip('brain', '', { iconOnly: true }), cchip('cloud', '', { iconOnly: true })], note: '<b>neuramesh</b> · Project default · <b>Cloud</b> · new branch from main' })}</div>
  ${kick('Recent')}
  ${srow({ kind: 'code', title: 'Add threadOrigin to mobile sends', snip: '⎇ nm/engineering/george/mobile-origin', snipMono: true, when: '2m', chipText: 'act', chipCls: 'act', live: true })}
  ${srow({ kind: 'code', ask: true, title: 'Relay attach for the phone', snip: '⎇ nm/engineering/george/relay-phone', snipMono: true, when: '14m', chipText: 'approval', chipCls: 'approval' })}
  ${srow({ kind: 'code', title: 'Explain the sleeper rung', snip: 'neuramesh · read-only', when: '1h', chipText: 'plan', chipCls: 'plan' })}
`)}
${tabbar('Code')}`,
  },
  {
    id: 'Routines', title: '10 · Routines',
    note: 'Automations’ two surfaces nest under one head as a segment (Routines · Calendar — the nav-nesting ruling at phone scale). A routine card is the desktop’s: title · cadence line · next run · last run · "n runs so far" as the door that opens the run history in place (no count, no door) · Pause / Edit. Runs are sessions; tapping one opens its thread.',
    html: () => `${safe}${head({ pill: 'online' })}
${body(`
  <div class="pad" style="display:flex;align-items:center;gap:8px;padding-bottom:4px">${segs(['Routines', 'Calendar'], 'Routines')}<span style="flex:1"></span><span class="scope" style="padding:0">All rooms ${ic('chevron', 12)}</span></div>
  <div class="rcard"><div class="rt">${ic('clock', 15)}<b>Daily brief</b>${chip('armed', 'armed')}</div><div class="rm">Weekdays · 09:00 Europe/London · #marketing · rex</div><div class="rn"><span><small>Next run</small>tomorrow 09:00</span><span><small>Last run</small>today 09:00 · 2m 40s</span></div><div class="door">${ic('chevron', 13)}<span>5 runs so far</span></div><div class="runrow"><b>Tue 09:00</b>3 items moved, 1 needs you</div><div class="runrow"><b>Mon 09:00</b>quiet day</div><div class="runrow"><b>Fri 09:00</b>drafted 2 posts</div><div class="acts">${btn('Pause', 'sm ghost')}${btn('Edit', 'sm ghost')}</div></div>
  <div class="rcard"><div class="rt">${ic('clock', 15)}<b>Weekly changelog</b>${chip('paused', 'paused')}</div><div class="rm">Fridays · 17:00 Europe/London · #build · rex</div><div class="rn"><span><small>Next run</small>paused</span><span><small>Last run</small>Fri 17:00 · 4m 12s</span></div><div class="door">${ic('chevronR', 13)}<span>2 runs so far</span></div><div class="acts">${btn('Resume', 'sm ghost')}${btn('Edit', 'sm ghost')}</div></div>
  <div class="rcard"><div class="rt">${ic('clock', 15)}<b>Dependency audit</b>${chip('armed', 'armed')}</div><div class="rm">Once · Sat 12 Sep 08:00 · #build · patch</div><div class="rn"><span><small>Next run</small>Sat 08:00</span><span><small>Last run</small>never ran</span></div><div class="acts">${btn('Edit', 'sm ghost')}${btn('Remove', 'sm ghost')}</div></div>
`)}
${fab}${tabbar('Routines')}`,
  },
  {
    id: 'RoutineThread', title: '11 · Tracking a routine’s run',
    note: 'A run is a session with the routine chip and the clock glyph; the head says who fired it, where it ran and how long it took. The last line is the routine’s one notification — the run finished, nothing is waiting on you — and replying continues the thread like any other.',
    html: () => `${safe}${shead({ crumb: 'routines', title: 'Daily brief · Tue 09:00', toks: [chip('routine', 'routine'), tok(`${ic('clock', 12)}weekdays 09:00`), tok(`${ic('cloud', 12)}Cloud`), tok('2m 40s')] })}
${body(`<div class="msgs">
  ${am({ who: 'rex', role: 'orchestrator', time: '09:00', prose: '<b>Morning status — #marketing</b><ul><li>#1057 plan approved · patch claimed it</li><li>2 posts drafted for Thursday · <b>1 needs you</b></li><li>X connector token rotated · fine</li></ul>' })}
  <div class="rr"><span class="w">${ic('checkCircle', 13)}</span><b>Routine finished · nothing is waiting on you</b><span class="n">09:02</span></div>
  ${hb('Move the Thursday posts to Friday.')}
  ${am({ who: 'rex', role: 'orchestrator', time: '9:51', prose: 'Done — both rescheduled to Fri 10:00. The calendar shows them in the posts lane.' })}
</div>`)}
${composer({ placeholder: 'Reply to rex…', chips: [clipChip] })}
${homebar}`,
  },
  {
    id: 'Calendar', title: '12 · Calendar',
    note: 'The time view of everything scheduled: automation firings (projected through the shared nextScheduleRun, never re-derived) and scheduled posts, two lanes told apart by their glyph. A day strip you can flick, an agenda underneath; a paused routine reads dim, a draft awaiting approval says so.',
    html: () => `${safe}${head({ pill: 'online' })}
${body(`
  <div class="pad" style="display:flex;align-items:center;gap:8px;padding-bottom:2px">${segs(['Routines', 'Calendar'], 'Calendar')}<span style="flex:1"></span><span class="serif" style="font-size:16px">September 2026</span></div>
  <div class="day"><span><small>MON</small>7</span><span class="on dot"><small>TUE</small>8</span><span class="dot"><small>WED</small>9</span><span class="dot"><small>THU</small>10</span><span class="dot"><small>FRI</small>11</span><span><small>SAT</small>12</span><span><small>SUN</small>13</span></div>
  ${kick('Tue 8 · today')}
  <div class="agenda"><span class="t">09:00</span><span class="g">${ic('clock', 13)}</span><span class="b"><b>Daily brief</b><small>#marketing · rex · fired ✓</small></span></div>
  <div class="agenda"><span class="t">17:00</span><span class="g post">${ic('post', 13)}</span><span class="b"><b>LinkedIn · “Your people. Your agents.”</b><small>scheduled · quill · #marketing</small></span></div>
  ${kick('Wed 9')}
  <div class="agenda"><span class="t">09:00</span><span class="g">${ic('clock', 13)}</span><span class="b"><b>Daily brief</b><small>#marketing · rex · next firing</small></span></div>
  <div class="agenda"><span class="t">11:00</span><span class="g post">${ic('post', 13)}</span><span class="b"><b>X · “The browser is the product.”</b><small>scheduled · quill · #marketing</small></span></div>
  ${kick('Fri 11')}
  <div class="agenda"><span class="t">10:00</span><span class="g post">${ic('post', 13)}</span><span class="b"><b>Instagram · launch carousel</b><small>draft · needs your approval</small></span></div>
  <div class="agenda dimmed"><span class="t">17:00</span><span class="g">${ic('clock', 13)}</span><span class="b"><b>Weekly changelog</b><small>#build · rex · paused</small></span></div>
  <div class="leg" style="margin-top:6px"><span class="w">${ic('clock', 13)}</span>an automation fires<small>lane 1</small></div>
  <div class="leg"><span class="w">${ic('post', 13)}</span>a post is scheduled<small>lane 2</small></div>
`)}
${tabbar('Routines')}`,
  },
  {
    id: 'Compute', title: '13 · Compute',
    note: 'Reached from the head’s machine pill. Team shape (the member-machines round): your machine — the reason line from machineState, the facts, what it is serving, Terminal (vendor logins happen in a terminal on YOUR machine, and a phone-only member has no other door); the credit ring one click in with its three named lines and never a per-reply price; the workspace runner with Wake now where it can succeed; teammates’ machines with owner, state and grant; the master sharing switch.',
    html: () => `${safe}${shead({ crumb: 'home', title: 'Compute', toks: [tok('Team · 3 members'), tok(`${ic('agents', 12)}6 agents`)] })}
${body(`
  ${card(`<div class="rt row">${ic('cloudMachine', 18)}<b style="flex:1;font-size:13.5px">george-cloud</b><span class="kind">your cloud machine</span></div><div class="rsn on">Awake and serving your agents.</div><div class="facts" style="margin-top:4px">up 2h 14m · worked 3m ago · sleeps after 48h idle</div><div class="serving"><span class="avs">${av('rex', 20)}${av('patch', 20)}</span><span>2 agents working here · claude · codex signed in</span></div><div class="btnrow">${btn(`${ic('term', 13)} Terminal`, 'sm ghost')}</div>`)}
  ${card(`<div class="row">${credring(0.83, 40)}<div class="big">1,238 <small>credits left</small></div></div><div class="ln" style="margin-top:6px"><span>Brain</span><span>262 used</span></div><div class="ln"><span>Machine</span><span>45 min worked today</span></div><div class="ln"><span>Storage</span><span>50 GB included</span></div><div class="facts" style="margin-top:4px">Refills to 1,500 on 1 Oct · connect your own brain and agents stop drawing credits</div>`)}
  ${card(`<div class="rt row">${ic('cloud', 18)}<b style="flex:1;font-size:13.5px">Cloud</b><span class="kind">cloud</span></div><div class="rsn sleep">Asleep until someone needs it. A message wakes it.</div><div class="facts" style="margin-top:4px">keys + the starter brain · seen 3h ago</div><div class="btnrow">${btn('Wake now', 'sm ghost')}</div>`)}
  <div class="mrow"><span class="b"><b>Share my compute with the workspace</b><small>Teammates’ requests, tasks and routines may run on your machine</small></span><span class="sw"></span></div>
  ${kick('Teammates’ machines')}
  <div class="mrow"><span class="g">${ic('cloud', 15)}</span><span class="b"><b>ada-cloud</b><small>Ada · shared with you</small></span><span class="pst sleep">☾</span>${btn('Wake now', 'sm ghost')}</div>
  <div class="mrow"><span class="g">${ic('machine', 15)}</span><span class="b"><b>ben-mbp</b><small>Ben · not shared</small></span><span class="pst on">●</span></div>
`)}
${homebar}`,
  },
  {
    id: 'Notifications', title: '14 · Notifications & deep links',
    note: 'Push reaches the lock screen for the human gates, a question card asked of you and a routine that finished (all three exist server-side today), plus the one kind this round adds: an approval waiting in a Code thread. Every tap deep-links to the exact surface (the neuramesh:// scheme the app already registers). A notification is not a destination: nothing here is a count you have to go and read.',
    html: () => `${safe}
${body(`
  ${kick('On the lock screen')}
  <div class="notif"><span class="app">${porch(22)}</span><span class="nb"><span class="nh"><b>Ready to accept · #1046</b><small>now</small></span><p>“iOS Safari focus-trap release” passed review — accept to merge.</p></span></div>
  <div class="notif"><span class="app">${porch(22)}</span><span class="nb"><span class="nh"><b>rex asked in #general</b><small>9m</small></span><p>Which room should the daily brief post to?</p></span></div>
  <div class="notif"><span class="app">${porch(22)}</span><span class="nb"><span class="nh"><b>Approval needed · Relay attach for the phone</b><small>14m</small></span><p>Apply patch · 3 files, on george-cloud.</p></span></div>
  <div class="notif"><span class="app">${porch(22)}</span><span class="nb"><span class="nh"><b>Routine finished · Daily brief</b><small>2h</small></span><p>3 items moved, 1 needs you.</p></span></div>
  <div class="notif"><span class="app">${porch(22)}</span><span class="nb"><span class="nh"><b>Plan ready · #1057</b><small>3h</small></span><p>“Daily brief in #marketing” — review the plan.</p></span></div>
  ${kick('Where a tap lands')}
  <div class="tr"><b>a task gate</b><span class="to">neuramesh://task/1046 → the gate card</span></div>
  <div class="tr"><b>a question card</b><span class="to">neuramesh://thread/… → at the card</span></div>
  <div class="tr"><b>a Code approval</b><span class="to">neuramesh://code/… → the approval</span></div>
  <div class="tr"><b>a routine finished</b><span class="to">neuramesh://thread/… → the run</span></div>
  <div class="tr"><b>a plan to review</b><span class="to">neuramesh://task/1057 → the plan</span></div>
  <div class="tr"><b>your machine</b><span class="to">neuramesh://compute → Compute</span></div>
`)}
${homebar}`,
  },
  {
    id: 'Vocabulary', title: '0 · Vocabulary',
    note: 'The signs this design spends, so the reviewer can gate on them: the machine chip and its states, the compute pill, the row glyphs, the credit ring, the state chips. Sample data throughout (workspace neuramesh · George · Ada · Ben · rex · patch · iris · quill); agent faces are DiceBear Thumbs in the app, monogram placeholders here.',
    html: () => `${safe}${shead({ crumb: 'design system', title: 'Vocabulary' })}
${body(`
  ${kick('The machine chip')}
  <div class="vg">${cchip('auto', 'Auto')}${cchip('cloud', 'george-cloud', { open: true })}${cchip('cloud', 'Cloud')}${cchip('cloud', 'ada-cloud')}</div>
  <div class="vl">Auto · your cloud machine · the runner · a lent machine. No “This Mac”: a phone is not a machine.</div>
  ${kick('Machine state — an icon; its word in the tooltip')}
  <div class="vg"><span class="pill"><span class="st-on">●</span> awake</span><span class="pill"><span class="st-waking">●</span> waking</span><span class="pill"><span class="st-sleep">☾</span> asleep</span><span class="pill"><span class="st-off">○</span> offline</span></div>
  ${kick('The compute pill in the head')}
  <div class="vg"><span class="hbtn cmp online">${ic('cloudMachine', 18)}</span><span class="hbtn cmp waking">${ic('cloudMachine', 18)}</span><span class="hbtn cmp asleep">${ic('cloudMachine', 18)}</span><span class="hbtn cmp capped">${ic('cloudMachine', 18)}</span><span class="vl" style="padding:0">awake · waking · asleep · out of credits</span></div>
  ${kick('Row glyphs')}
  <div class="leg"><span class="w"><span class="sglyph">${ic('threads', 11)}</span></span>a conversation<small>chat</small></div>
  <div class="leg"><span class="w"><span class="sglyph code">${ic('code', 11)}</span></span>a Code session<small>code</small></div>
  <div class="leg"><span class="w"><span class="sglyph routine">${ic('clock', 11)}</span></span>a routine’s run<small>routine</small></div>
  <div class="leg"><span class="w">${dial('todo', 10)}</span>a task waiting<small>todo</small></div>
  <div class="leg"><span class="w">${dial('in_progress', 62)}</span>a task in build<small>in_progress</small></div>
  <div class="leg"><span class="w">${dial('accepted', 100)}</span>a task settled<small>accepted</small></div>
  <div class="leg"><span class="w">${orb(16)}</span>an open run — the glyph swaps for the orb<small>live</small></div>
  <div class="leg"><span class="w"><span class="ask"></span></span>waiting on you — at the trailing edge<small>ask</small></div>
  ${kick('The credit ring')}
  <div class="vg">${credring(0.83)}<span class="vl" style="padding:0">83%</span>${credring(0.15)}<span class="vl" style="padding:0">below a fifth · warm</span><span class="vl" style="padding:0 0 0 8px">could not read · draws nothing</span></div>
  ${kick('State chips')}
  <div class="vg">${chip('plan_review', 'plan review')}${chip('in_progress', 'build')}${chip('in_review', 'review')}${chip('done', 'accept?')}${chip('accepted', 'accepted')}${chip('blocked', 'blocked')}${chip('chat', 'chat')}${chip('routine', 'routine')}${chip('code', 'code')}${chip('act', 'act')}${chip('plan', 'plan')}${chip('approval', 'approval')}</div>
`, '', 'tight')}
${homebar}`,
  },
];
// ── onboarding: the browser wizard's order (Workspace · Machine · Keys · Team · Launch), one screen per step ──
const obtop = (n, label) => {
  const C = 2 * Math.PI * 14;
  return `<div class="obtop"><span class="wmk">${porch(18)}neuramesh</span><span class="obring"><svg viewBox="0 0 34 34" aria-hidden="true"><circle class="trk" cx="17" cy="17" r="14"/><circle class="arc" cx="17" cy="17" r="14" stroke-dasharray="${(C * n / 5).toFixed(1)} ${C.toFixed(1)}"/></svg><b>${n}<i>/5</i></b></span><span class="obstep">${label}</span></div>`;
};
const obnav = (primary, { back = true, primaryCls = 'primary' } = {}) => `<div class="obnav">${back ? btn('← Back') : ''}<span class="sp"></span>${btn(primary, primaryCls)}</div>`;
const prov = (mark, name, sub, modes, on) => `<div class="prov"><span class="pl">${mark}</span><span class="pb"><b>${name}</b><small>${sub}</small></span><span class="pm">${modes.map((m) => `<span${m === on ? ' class="on"' : ''}>${m}</span>`).join('')}</span></div>`;
const CREW = [['rex', 'orchestrator'], ['iris', 'designer'], ['atlas', 'architect'], ['patch', 'developer'], ['scout', 'reviewer'], ['bosun', 'shipper']];

export const ONBOARDING = [
  {
    id: 'Account', title: 'O1 · Create your account',
    note: 'Start free opens the handoff page in Safari in sign-up mode — the same Clerk card the desktop and the browser use (Google · GitHub · email), with the cloud-first line under the title. No machine is born here: a machine’s precondition is a workspace id, and sign-up only makes an account. The sheet returns to the app on completion.',
    html: () => `${safe}
<div class="sheetk">${ic('lock', 12)}<span>neuramesh.app · opens in Safari, returns here</span></div>
${body(`
  <div class="clerk">
    <div class="row" style="gap:8px">${porch(24)}<span class="wm" style="font-size:18px">neuramesh</span></div>
    <h4>Create your account</h4>
    <div class="sub">Your workspace and its free cloud machine come with your account.</div>
    <div class="oauth">${btn('Continue with Google')}${btn('GitHub')}</div>
    <div class="ordiv">or with email</div>
    <div class="field ph" style="margin:0">email</div>
    <div class="field ph" style="margin:0">password</div>
    ${btn('Create account →', 'primary')}
    <div class="dim" style="font-size:12px;text-align:center">Already have one? <b style="color:var(--link);font-weight:600">Sign in</b></div>
  </div>
  <div class="dim" style="font-size:11px;text-align:center;padding:14px 24px 0;line-height:1.5">Email verification and OAuth happen on neuramesh.app; the app only ever receives a verified session.</div>
`)}
${homebar}`,
  },
  {
    id: 'Workspace', title: 'O2 · Step 1 of 5 — Workspace',
    note: 'The shipped Create-your-workspace screen, first in the wizard because a cloud machine is provisioned against a workspace id: Continue mints the workspace, the fleet writes the runner row, the signup grant lands. Name pre-filled and selected, one keystroke to replace.',
    html: () => `${safe}${obtop(1, 'Workspace')}
${body(`
  <div class="obeye">Step 1 of 5</div>
  <div class="obtitle">Create your workspace</div>
  <div class="obsub">Name it and pick its address — your free cloud machine is born the moment you continue.</div>
  <div class="obfield">Cobalt Labs</div>
  <div class="obslug"><span class="pre">hq.neuramesh.app/</span><span class="val">cobalt-labs</span></div>
  <div class="obhint">your address — edit it freely · seeds #general #build #marketing · Individual plan: one person, one cloud machine, 500 credits</div>
`, 'display:flex;flex-direction:column')}
${obnav('Continue →', { back: false })}
${homebar}`,
  },
  {
    id: 'Machine', title: 'O3 · Step 2 of 5 — Machine',
    note: 'A watch-it-come-up beat that never blocks: provisioning began at the previous step’s Continue and the Launch step absorbs whatever is left. The dial vocabulary is the one every later surface uses (provisioning → waking → awake → idle). The phone says what the browser says, with “this phone” where the browser said “this tab”.',
    html: () => `${safe}${obtop(2, 'Machine')}
${body(`
  <div class="obeye">Step 2 of 5</div>
  <div class="obtitle">Your machine is starting</div>
  <div class="obsub"><b>Cobalt Labs</b> just got its cloud machine — free to start. Your agents run there, even while this phone is in your pocket. A Mac can join later as home base.</div>
  <div class="obmach"><span class="g">${ic('cloudMachine', 18)}</span><span class="b"><b>cobalt-labs · cloud</b><small>provisioning · private namespace · us-east4</small></span><span class="obdot"></span></div>
  <div class="obhint">outbound-only · gVisor-sandboxed · your code and keys never leave it</div>
  <div class="obhint" style="padding-top:4px">Continue never waits on it — usually awake before you finish the next two steps.</div>
`, 'display:flex;flex-direction:column')}
${obnav('Continue →')}
${homebar}`,
  },
  {
    id: 'Brain', title: 'O4 · Step 3 of 5 — Keys',
    note: 'The one cloud delta: a subscription cannot be verified from a phone, so choosing it records the intent and the sign-in completes later in a terminal on your machine (the platform never handles the vendor login). API keys work at once. The starter door is the distinguished object: every workspace comes with 500 credits, and Keys is never a gate.',
    html: () => `${safe}${obtop(3, 'Keys')}
${body(`
  <div class="obeye">Step 3 of 5</div>
  <div class="obtitle">Bring your own brain</div>
  <div class="obsub">Reuse the subscriptions you already pay for — you sign in on your cloud machine after launch, through its own terminal. Or drop in an API key now.</div>
  ${prov('A', 'Claude', 'sign in on your machine after launch', ['subscription', 'API key'], 'subscription')}
  ${prov('O', 'ChatGPT / Codex', 'device sign-in on your machine after launch', ['subscription', 'API key'], null)}
  ${prov('G', 'Gemini', 'API key — Google allows no login on cloud machines', ['API key'], null)}
  <div class="obskip"><b>Or start now — your agents are ready.</b><small>Every workspace comes with 500 credits to run on. Connect your own brain whenever you like.</small>${btn('Start with 500 credits →', 'primary')}</div>
`, 'display:flex;flex-direction:column')}
${obnav('Continue with these →', { primaryCls: '' })}
${homebar}`,
  },
  {
    id: 'Team', title: 'O5 · Step 4 of 5 — Team',
    note: 'The starting crew, named and brained before the workspace launches: the orchestrator and its skill-matched pod, each on the brain the active pack assigns (the house brain when nothing is connected). Renaming here is the first act of ownership; the face follows the name.',
    html: () => `${safe}${obtop(4, 'Team')}
${body(`
  <div class="obeye">Your starting team</div>
  <div class="obtitle">Meet your <span class="acc">crew</span>.</div>
  <div class="obsub">Your orchestrator already has a skill-matched team — each running the brain your <b>Starter</b> pack assigned. Tweak any name or model now, or anytime in Settings.</div>
  ${CREW.map(([n, r]) => `<div class="crewcard">${av(n, 34)}<span class="cb"><b>${n}</b><small>${r}</small></span><span class="mdl">NeuraMesh Starter ▾</span></div>`).join('')}
`, 'display:flex;flex-direction:column')}
${obnav('Continue →')}
${homebar}`,
  },
  {
    id: 'Launch', title: 'O6 · Step 5 of 5 — Launch',
    note: 'The reveal: the workspace is live, the crew registers on the CLOUD machine (the browser’s onboard — no phone is a machine), the stats row counts a cloud machine online, the CTA is the shipped one. Any provisioning residue is absorbed here; no spinner wall.',
    html: () => `${safe}${obtop(5, 'Launch')}
${body(`
  <div class="obeye" style="text-align:center">Team assembled</div>
  <div class="obtitle" style="text-align:center"><span class="acc">Cobalt Labs</span> is live.</div>
  <div class="reveal">${CREW.map(([n, r]) => `<span class="m">${av(n, 48).replace('</span>', '<i></i></span>')}<b>${n}</b><small>${r}</small></span>`).join('')}</div>
  <div class="stats"><span><b>6</b> agents</span><span><b>1</b> cloud machine online</span><span><b>3</b> channels</span></div>
`, 'display:flex;flex-direction:column')}
<div class="obnav" style="justify-content:center">${btn('Meet @rex — start your first fan-out →', 'primary')}</div>
${homebar}`,
  },
  {
    id: 'FirstReply', title: 'O7 · The first reply, on your cloud machine',
    note: 'Where the promise lands: the first send from the phone births a session designated to the cloud machine, the orchestrator answers on it under the starter brain, and the attribution says so under the first few replies before retiring to run details. The composer already wears the machine chip.',
    html: () => `${safe}${shead({ crumb: '#general · conversations', title: 'What can this workspace do?', toks: [chip('chat', 'chat'), tok(`${ic('cloud', 12)}cobalt-labs`)] })}
${body(`<div class="msgs">
  ${hb('What can this workspace do?')}
  ${am({ who: 'rex', role: 'orchestrator', time: 'now', prose: 'Quite a lot — and I’ll show you rather than list features. You have three rooms, a board, and five teammates. Give me a repo or an idea and I’ll plan it into tasks they can build, review, and ship. Or just keep asking.' })}
  <div class="attr">on your cloud machine · replied in 4s</div>
  <div class="vg" style="margin-top:14px"><span class="pill">Plan a landing page</span><span class="pill">Connect a repo</span><span class="pill">What can the crew do?</span></div>
</div>`)}
${composer({ placeholder: 'Message #general…', chips: [cchip('hash', 'general'), brainpill(['rex', 'patch', 'iris']), cchip('cloud', 'cobalt-labs'), clipChip], note: '<b>rex</b> picks it up in #general · your machine · awake' })}
${homebar}`,
  },
  {
    id: 'Setup', title: 'O8 · After the first exchange — setup, kindly',
    note: 'Setup never blocks the first reply; it follows it. The desktop’s floating tracker becomes a card pinned where the room brief lives — order is the argument (the machine leads because it is already done; the subscription leads the asks; the desktop is optional and last), and it folds to a pill. No “mobile app” item: you are holding it. The credit ring reads full.',
    html: () => `${safe}${head({ pill: 'online', ring: 1 })}
${body(`
  <div class="setup"><div class="sh"><b>Set up Cobalt Labs</b><small>1 / 4</small>${ic('chevron', 13)}</div>
    <div class="sti done"><span class="bx">${ic('check', 10)}</span><span>Cloud machine · provisioned and awake</span></div>
    <div class="sti"><span class="bx"></span><span>Bring your subscription</span><span class="verb">Connect</span></div>
    <div class="sti"><span class="bx"></span><span>Invite your team · on Team, each gets a machine</span><span class="verb">Invite</span></div>
    <div class="sti"><span class="bx"></span><span>Desktop app · optional, your Mac as home base</span><span class="verb">Get</span></div>
  </div>
  ${kick('Today')}
  ${srow({ kind: 'chat', title: 'What can this workspace do?', snip: 'rex → you · "Quite a lot — and I’ll show you…"', when: '#general' })}
  <div class="emp">Your rooms are ready.<small>#general · #build · #marketing — ask rex for anything, or park an idea on the Tasks board.</small></div>
`)}
${fab}${tabbar('Home')}`,
  },
  {
    id: 'Invited', title: 'O9 · First run with an invitation',
    note: 'The state that breaks if you get it wrong: an invited newcomer has zero memberships, which is exactly the onboarding signal. The phone reads pending invitations after sign-in and offers the join before any wizard — joining is free and instant; setting up your own comes after, never instead.',
    html: () => `${safe}
${body(`
  <div class="row" style="justify-content:center;gap:6px;padding:18px 16px 4px">${porch(18)}<span class="wm" style="font-size:17px">neuramesh</span></div>
  <div class="obtitle" style="text-align:center;font-size:22px;padding-top:14px">Ada is expecting you</div>
  <div class="obsub" style="text-align:center">You were invited to a workspace that already has a team and a board running.</div>
  <div class="invtile"><span class="wstile">A</span><span class="b"><b>Acme Robotics</b><small>ada@acme.dev · joining as member · Team</small></span></div>
  <div class="obhint" style="text-align:center">On Team you get your own cloud machine when you join — your logins live on it, nowhere else.</div>
  <div style="padding:16px 16px 0">${btn('Join Acme Robotics', 'primary')}</div>
  <div class="orsep">or</div>
  <div style="padding:0 16px">${btn('Set up my own workspace')}</div>
  <div class="dim" style="font-size:11.5px;text-align:center;padding:14px 24px 0;line-height:1.5">You can do both — joining now doesn’t stop you starting your own later.</div>
`)}
${homebar}`,
  },
  {
    id: 'Joined', title: 'O10 · Joined a Team workspace — your own machine',
    note: 'Accepting the invitation provisions the member’s machine (born asleep, credits-gated) and lands on Home with the join moment: the compute intro names YOUR machine, says what sharing means, and offers the switch. The head’s pill reads waking while it comes up.',
    html: () => `${safe}${head({ ws: 'Acme Robotics', pill: 'waking', ring: 0.92 })}
${body(`
  ${card(`<div class="qk">you joined acme robotics</div><div class="qh">Acme Robotics gave you a machine</div><div class="obmach" style="margin:6px 0 0;padding:10px 11px"><span class="g">${ic('cloudMachine', 18)}</span><span class="b"><b>george-cloud · your cloud machine</b><small>provisioning · your logins live here, nowhere else</small></span><span class="obdot"></span></div><div class="sub" style="margin-top:8px">Shared with the workspace by default — teammates’ tasks and routines may run on it, on your subscription. Change it any time.</div><div class="mrow" style="padding:8px 0 0"><span class="b"><b>Share my compute with the workspace</b></span><span class="sw"></span></div><div class="btnrow">${btn('Open Compute', 'sm ghost')}${btn('Done', 'sm')}</div>`)}
  ${kick('Today')}
  ${srow({ kind: 'task', state: 'in_progress', live: true, title: '#312 · Onboarding email sequence', snip: 'patch · drafting step 3 · 2/4', when: '#marketing' })}
  ${srow({ kind: 'chat', title: 'Welcome George — the lay of the land', snip: 'ada → you · "rex runs the board, ask it anything"', when: '#general' })}
`)}
${fab}${tabbar('Home')}`,
  },
];
