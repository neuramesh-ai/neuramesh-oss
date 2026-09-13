import { makeMockNm } from './mock-nm';
import { mountShell } from './shell';
// registers window.__nmAgentSays / __nmHumanSays / __nmHumanSaysInConvo — the states a shot
// cannot reach by clicking (see harness-hooks.ts)
import './harness-hooks';
// match the production renderer entry (main.tsx): self-hosted Geist + serifs +
// Bricolage (wordmark) + tokens
import '@neuramesh/fonts/neuramesh-sans.css';
import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import '../src/tokens.css';

// ?theme=dark|light|soft-dark|cream-oak forces a theme for paired light/dark captures.
const params = new URLSearchParams(location.search);
const theme = params.get('theme');
if (theme) localStorage.setItem('nm:theme', theme);
// ?plan=cloud flips isCloud (the plan-gating source of truth) for ungated captures.
if (params.get('plan') === 'cloud') localStorage.setItem('nm:plan', 'cloud');
else localStorage.removeItem('nm:plan');
// ?navmode=code seeds the rail's Chat | Code switch (rail-ink round).
if (params.get('navmode') === 'code') localStorage.setItem('nm:navMode', 'code');
else localStorage.removeItem('nm:navMode');
// ?navview=recents seeds the rail's RECENTS · PROJECTS switch (the nav-recents round).
if (params.get('navview') === 'recents') localStorage.setItem('nm:navView', 'recents');
else localStorage.removeItem('nm:navView');
// ?conns=1|2 (U3b) seeds one or two connections and ?bandfold= folds a band — both read by the mock
// (mock-connections.ts); the foot's menu (artboard B4) opens through ?click=workspace%20menu below.
// ?navpos=left|top|right docks the unified nav for paired-position captures.
const navpos = params.get('navpos');
if (navpos === 'top' || navpos === 'right' || navpos === 'left') localStorage.setItem('nm:navPos', navpos);
else localStorage.removeItem('nm:navPos');
// ?project=<id> forces the active project pre-mount (verifies per-project channel/chat scoping).
const proj = params.get('project');
if (proj) localStorage.setItem('nm:activeProject', proj);
else localStorage.removeItem('nm:activeProject');
// ?navscope=<projectId>[:<channelId>] seeds the RAIL's scope (the flat round, 2026-08-17), so the
// three states — All projects · a project · a project and a room — are each capturable directly
// instead of by driving two menus. Absent = All projects, the resting state.
const navscope = params.get('navscope');
if (navscope) {
  const [projectId, channelId] = navscope.split(':');
  localStorage.setItem('nm:navScope', JSON.stringify({ projectId: projectId || null, channelId: channelId || null }));
} else localStorage.removeItem('nm:navScope');
// ?wtabs=file,browser seeds the persisted workspace tab set (docs/36) so a capture can shoot a
// file or a browser tab without driving the ＋ flyout first. TERMINALS are deliberately absent:
// they do not persist (a revived terminal tab would be a prompt with no shell behind it), so the
// harness has to open one the way a person does. ?wtpane=1 opens the pane, which starts dismissed.
const wtabsSeed = params.get('wtabs');
const WT_ROOT = '~/.neuramesh/worktrees/nm-1046';
if (wtabsSeed) {
  const set: unknown[] = [];
  if (wtabsSeed.includes('file')) set.push({ id: 'wt-file', kind: 'file', title: 'NavDrawer.tsx', subtitle: 'src/components/NavDrawer.tsx', path: `${WT_ROOT}/src/components/NavDrawer.tsx`, root: WT_ROOT, mode: 'edit' });
  if (wtabsSeed.includes('md')) set.push({ id: 'wt-md', kind: 'file', title: 'focus-trap.md', subtitle: 'docs/focus-trap.md', path: `${WT_ROOT}/docs/focus-trap.md`, root: WT_ROOT, mode: 'preview' });
  if (wtabsSeed.includes('browser')) set.push({ id: 'wt-browser', kind: 'browser', title: 'localhost:5173', url: 'http://localhost:5173' });
  localStorage.setItem('nm:workspaceTabs', JSON.stringify(set));
} else localStorage.removeItem('nm:workspaceTabs');
localStorage.removeItem('nm:dockTabs');
localStorage.setItem('nm:wtabsPane', params.get('wtpane') === '1' ? '1' : '0');
// ?dock=1 unfolds the side dock (rail-ink round 3); a seeded tab set unfolds it on its own, the way
// a tab coming to the front does in the app
localStorage.setItem('nm:sideDock', params.get('dock') === '1' || !!wtabsSeed ? '1' : '0');

// skip the first-send welcome coach + the guided tour so screenshots show the steady-state app.
localStorage.setItem('nm:welcomed', '1');
localStorage.setItem('nm:toured', '1');
// the compute join card (0118) is one-per-workspace; dismissed by default so every other capture
// stays card-free. ?computecard=1 clears the marker (and unsets the mock prefs trigger) to shoot it.
if (params.get('computecard')) localStorage.removeItem('nm:computecard:ws-acme');
else localStorage.setItem('nm:computecard:ws-acme', '1');
// same idiom for the setup tracker (cloud-first round): it retires itself as a workspace gets
// set up, so it is dismissed by default here and ?setupcards=1 clears the marker to shoot it.
if (params.get('setupcards')) localStorage.removeItem('nm:setupdismissed');
else localStorage.setItem('nm:setupdismissed', '1');

// Install the mock bridge BEFORE App's module evaluates — App reads window.nm at
// import time (const nm = window.nm), so the dynamic import below must come after.
// ?client=web makes the mock report itself as the BROWSER client, so every IS_WEB branch
// (lib/platform.ts) renders here — web-only copy and layout become screenshotable with the
// full driver set below, instead of needing a deploy and a real session to look at.
const mockNm = makeMockNm();
if (params.get('client') === 'web') mockNm.electron = 'web';
(window as unknown as { nm: unknown }).nm = mockNm;

void import('../src/App').then(async ({ App }) => {
  // ?nmpeek=full|wake mounts the launch overlay for evidence captures; captures of
  // the steady-state app stay peek-free by default.
  const LaunchPeek = params.get('nmpeek') ? (await import('../src/brand')).LaunchPeek : null;
  // the shell remounts on a foreground swap (U3b), exactly as renderer/main.tsx's does — preview/shell.tsx
  mountShell(App, mockNm, LaunchPeek ? <LaunchPeek /> : null);
  // ?click=<aria-label> drives the icon rail after first paint so any of the 8
  // views can be screenshotted (e.g. ?theme=dark&click=Board). Polls until the
  // button mounts (App boots async off the mock bridge).
  // ?screen=onboard&to=N steps the onboarding wizard to step N (fills inputs + clicks
  // Continue) so any step — including the step-5 fan-out — can be screenshotted headlessly.
  const onboardTo = params.get('onboarding') === 'keys' ? 2 : params.get('screen') === 'onboard' ? parseInt(params.get('to') || '1', 10) : 0; // ?onboarding=keys is the Keys step (artboard G)
  if (onboardTo > 1) {
    const setVal = (el: Element | null, val: string) => {
      if (!el) return;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let guard = 0;
    const adv = setInterval(() => {
      if (guard++ > 80) { clearInterval(adv); return; }
      const eyebrow = document.querySelector('.obeyebrow');
      if (!eyebrow) return;
      const cur = parseInt((eyebrow.textContent || '').replace(/\D+/g, '')[0] || '1', 10);
      if (cur >= onboardTo) { clearInterval(adv); return; }
      if (cur === 1) (document.querySelector('.obsim') as HTMLElement | null)?.click();
      if (cur === 2) setVal(document.querySelector('.obbody input[type=password]'), 'sk-ant-demo-key');
      if (cur === 3) setVal(document.querySelector('.obbody > input'), 'Acme Robotics');
      if (cur === 4) setVal(document.querySelector('.obgoal'), 'The marketing-site mobile nav is broken on iOS Safari — fix the focus trap and ship it today.');
      const cont = Array.from(document.querySelectorAll('.obnav .btn.primary')).find((b) => /Continue/.test(b.textContent || '')) as HTMLButtonElement | null;
      if (cont && !cont.disabled) cont.click();
    }, 230);
  }
  // ?click=A,B,C clicks each (by aria-label, then title, then title-contains) in sequence
  // as it mounts — e.g. ?click=Agents,Marketplace opens a nested surface.
  const click = params.get('click');
  if (click) {
    const labels = click.split(',').map((s) => s.trim()).filter(Boolean);
    const sel = (label: string) =>
      (document.querySelector(`[aria-label="${label}"]`) ||
        document.querySelector(`[title="${label}"]`) ||
        document.querySelector(`[title*="${label}" i]`)) as HTMLElement | null;
    let idx = 0;
    let tries = 0;
    const iv = setInterval(() => {
      if (idx >= labels.length) { clearInterval(iv); return; }
      const btn = sel(labels[idx]!);
      if (btn) { btn.click(); idx++; tries = 0; }
      else if (++tries > 50) clearInterval(iv);
    }, 90);
  }
  // ?clicktext=A,B clicks each element (button/[role=button]/board card/agent card) whose visible
  // text contains the label, in sequence — e.g. ?click=Board&clicktext=%231050,Review design
  // opens a task's thread from the board and then its DesignReview panel, and
  // ?clicktext=Agents %26 machines,orchestrator opens the orchestrator's AgentDetails.
  const clicktext = params.get('clicktext');
  if (clicktext) {
    const labels = clicktext.split(',').map((s) => s.trim()).filter(Boolean);
    let idx = 0;
    let tries = 0;
    const iv = setInterval(() => {
      if (idx >= labels.length) { clearInterval(iv); return; }
      const el = Array.from(document.querySelectorAll('button, [role="button"], .tcard, .agentcard'))
        .find((x) => (x.textContent || '').includes(labels[idx]!)) as HTMLElement | null;
      if (el) { el.click(); idx++; tries = 0; }
      else if (++tries > 60) clearInterval(iv);
    }, 140);
  }
  // ?switchTo=<slug|name> reproduces a REAL project switch: after boot (on the default project),
  // open the top-left switcher and click the matching project — exercises setActiveProject, not the
  // localStorage pre-set that ?project= uses.
  const switchTo = (params.get('switchTo') || '').toLowerCase();
  if (switchTo) {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 80) { clearInterval(iv); return; }
      if (!document.querySelector('.projmenu')) {
        (document.querySelector('.wsswitch') as HTMLElement | null)?.click();
        return;
      }
      const item = Array.from(document.querySelectorAll('.projmenu-item'))
        .find((el) => (el.textContent || '').toLowerCase().includes(switchTo)) as HTMLElement | null;
      if (item) { item.click(); clearInterval(iv); }
    }, 110);
  }
  // ?modal=newproject opens the New-project modal (switcher → + New project) for a screenshot.
  if (params.get('modal') === 'newproject') {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 80) { clearInterval(iv); return; }
      if (document.querySelector('.modal')) { clearInterval(iv); return; }
      if (!document.querySelector('.projmenu')) { (document.querySelector('.wsswitch') as HTMLElement | null)?.click(); return; }
      (document.querySelector('.projmenu-new') as HTMLElement | null)?.click();
    }, 110);
  }
  // ?modal=newchannel opens the New-channel modal (Channels header → +) for a screenshot.
  if (params.get('modal') === 'newchannel') {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 80 || document.querySelector('.modal')) { clearInterval(iv); return; }
      (document.querySelector('.chanadd') as HTMLElement | null)?.click();
    }, 110);
  }
  // ?modal=channelsettings opens the first room's settings (its hover gear) for a screenshot.
  if (params.get('modal') === 'channelsettings') {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 80 || document.querySelector('.modal')) { clearInterval(iv); return; }
      (document.querySelector('.chan .changear') as HTMLElement | null)?.click();
    }, 110);
  }
  // ?modal=policy opens Workspace settings on the Policy tab (account flyout → Workspace
  // settings → Policy). The flyout item + tab are text-only, so match by text not aria-label.
  if (params.get('modal') === 'policy') {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 120) { clearInterval(iv); return; }
      if (!document.querySelector('.modal')) {
        const item = Array.from(document.querySelectorAll('.acctitem')).find((b) => /Workspace settings/.test(b.textContent || '')) as HTMLElement | null;
        if (item) { item.click(); return; }
        (document.querySelector('.navuser') as HTMLElement | null)?.click();
        return;
      }
      const tab = Array.from(document.querySelectorAll('.wstab')).find((b) => (b.textContent || '').trim() === 'Policy') as HTMLElement | null;
      if (tab) {
        tab.click();
        clearInterval(iv);
        // ?addpath=1 also reveals the "add protected path" input (clicks "+ Add path")
        if (params.get('addpath') === '1') {
          let t2 = 0;
          const iv2 = setInterval(() => {
            if (++t2 > 40) { clearInterval(iv2); return; }
            const add = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '+ Add path') as HTMLElement | null;
            if (add) { add.click(); clearInterval(iv2); }
          }, 80);
        }
      }
    }, 110);
  }
  // ?channel=<slug> selects a room by slug (e.g. land on #dev where patch is working).
  const channel = params.get('channel');
  if (channel) {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 90) { clearInterval(iv); return; }
      const row = Array.from(document.querySelectorAll('.chan'))
        .find((c) => { const l = c.querySelector('.lbl'); return l && (l.textContent || '').trim().toLowerCase().startsWith(channel.toLowerCase()); }) as HTMLElement | null;
      if (row) { row.click(); clearInterval(iv); }
    }, 90);
  }
  // ?openConvo=<chanSlug>::<rowTextToken> opens a seeded conversation thread headlessly: select the
  // channel, open its history panel, then click the .histrow whose text contains the token. Fully
  // sequenced (no race with the separate ?channel handler) so the ConvoThread sheet renders for shots.
  const openConvo = params.get('openConvo');
  if (openConvo) {
    const [cslug, token] = openConvo.split('::');
    let phase = 0; let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 240) { clearInterval(iv); return; }
      if (phase === 0) {
        // selecting the channel row ALSO opens its history panel (App.tsx), so no separate button click
        const row = Array.from(document.querySelectorAll('.chan'))
          .find((c) => { const l = c.querySelector('.lbl'); return l && (l.textContent || '').trim().toLowerCase().startsWith((cslug || '').toLowerCase()); }) as HTMLElement | null;
        if (row) { row.click(); phase = 1; }
        return;
      }
      const hit = Array.from(document.querySelectorAll('.histrow'))
        .find((x) => (x.textContent || '').includes(token || '')) as HTMLElement | null;
      if (hit) { hit.click(); clearInterval(iv); return; }
      // history not open (or reclosed)? open it — but only if the panel isn't already showing
      if (!document.querySelector('.histwrap')) (document.querySelector('[aria-label="Channel history"]') as HTMLElement | null)?.click();
    }, 130);
  }
  // ?modal=activity opens an agent's activity log (clicks the "@x is working… view activity" chip,
  // which only mounts on a room where an agent is busy — pair with ?channel=dev).
  if (params.get('modal') === 'activity') {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 110 || document.querySelector('.modal')) { clearInterval(iv); return; }
      (document.querySelector('.typist.clickable') as HTMLElement | null)?.click();
    }, 110);
  }
  // ?modal=createagent / agentedit open the Create-agent / agent-details modal from the Agents grid.
  if (params.get('modal') === 'createagent' || params.get('modal') === 'agentedit') {
    const which = params.get('modal');
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 110 || document.querySelector('.modal')) { clearInterval(iv); return; }
      if (!document.querySelector('.agentcard')) { (document.querySelector('[aria-label="Agents"]') as HTMLElement | null)?.click(); return; }
      const seln = which === 'createagent' ? '.agentcard.create' : '.agentcard:not(.create):not(.ext)';
      (document.querySelector(seln) as HTMLElement | null)?.click();
    }, 110);
  }
  // ?openTask=N opens a task's panel headlessly: task cards (.tcard) carry no aria-label, so
  // navigate to a room's Board, then click the card whose text contains #N. Unlocks the header
  // toks + their drawers and the thread composer (for the ?stream=thread indicator).
  // Pair with ?channel=<slug> for a task outside #dev — the app boots on Home, which has no board.
  // ?openTask=<number> opens a task thread. The nav is a projects TREE since v0.88 and the board
  // is a room tab — so rather than chasing either, click the task's own row in the nav history
  // rail, which carries every recent task and is present from boot. (?drawer= is gone with the
  // drawers themselves — docs/25 round 2 replaced them with the thread rail.)
  // ?openConvo=<row text> is the same driver: the rail lists chats and tasks alike, so a chat
  // thread opens by a token of its title. (Its old `<slug>::<token>` form clicked the retired
  // `.chan` rows and had rotted with the sessions shell — found in the rail-ink round.)
  const openTask = params.get('openTask') ?? params.get('openConvo')?.split('::').pop() ?? null;
  if (openTask) {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 90) { clearInterval(iv); return; }
      if (document.querySelector('.threadpanel:not(.convo)')) { clearInterval(iv); return; }
      // …and the rail CAPS its rows (NAV_FLAT_CAP), so a fixture below the cap is simply not in
      // the DOM to match — which is not "no such task", it is "not on screen yet". Lift the cap
      // once before giving up, the same gesture a human makes: the `n more ›` button in the tree
      // era, `Everything else ⌘Y` (the .navprojmore opener → the ⌘Y overlay's .histrow rows)
      // since the flat round. Found 2026-08-11; door re-rotted 2026-08-18 when the label changed.
      if (tries === 12) {
        // …and since the grouped rail (rail-ink round) each project folder caps its own rows behind
        // `Show n more`, so lift every folder's cap as well as the flat list's door
        for (const b of Array.from(document.querySelectorAll('button'))) {
          if (/more ›|Everything else|^Show \d+ more$/.test((b.textContent || '').trim())) (b as HTMLElement).click();
        }
      }
      // Rows read "#dev1042Mobile nav…" since the recents rows gained their room tag — they no
      // longer START with the number, which silently broke every ?openTask= capture (found while
      // building the task-peek evidence, 2026-08-10). Match the number with digit boundaries
      // instead of a prefix, so a row's leading `#room` — or any later prefix — cannot break it,
      // and #104 can never match #1046.
      const hit = new RegExp(`(^|\\D)${openTask}(\\D|$)`);
      const row = Array.from(document.querySelectorAll('.navhistrow, .histrow'))
        .find((e) => hit.test((e.textContent || '').trim())) as HTMLElement | null;
      if (row) row.click();
    }, 120);
  }

  const draft = params.get('draft');
  if (draft) {
    const setVal = (el: Element, val: string) => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let tries = 0;
    let last: Element | null = null;
    let stable = 0;
    const iv = setInterval(() => {
      if (++tries > 120) { clearInterval(iv); return; }
      const ta = document.querySelector(openTask ? '.tcompose .cbox textarea' : '.composer .cbox textarea');
      if (!ta) { last = null; stable = 0; return; }
      stable = ta === last ? stable + 1 : 0;
      last = ta;
      if (stable < 3) return;
      setVal(ta, draft);
      (ta as HTMLTextAreaElement).focus();
      clearInterval(iv);
    }, 120);
  }
});
