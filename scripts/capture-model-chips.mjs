// Evidence for the model chip and the agent chip (docs/design/models-and-replies-2026-10/plan.md §4,
// boards D1 to D5, D9, D11, D12). It drives hq's preview harness (the real <App/> on the mock bridge,
// apps/hq/preview/mock-models.ts) in real Chrome over its DevTools protocol, arm64, served over http.
//
//   pnpm -C apps/hq preview:build && node scripts/capture-model-chips.mjs
//
// The claims, per theme: the composer carries the model of the agent it talks to and the agent beside
// Send; the model menu lists the house brain and each provider in its state; a level and a model pick
// land as the person's own pick and the chip follows; the agent menu shows each agent's model for the
// person, changes one agent's model, and offers New agent; picking an agent retargets the model chip
// and Send names that agent; an automation's session runs on the NeuraMesh brain; New session, Settings
// › Models and onboarding's Team step carry the same model. Every step polls and THROWS if it never holds.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'apps/hq/out/preview');
const OUT = join(ROOT, 'docs/design/models-and-replies-2026-10/evidence');
const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const THEMES = [['dark', 'dark'], ['cream-oak', 'light']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => console.log(`[capture-model-chips] ${m}`);

if (!existsSync(join(DIR, 'index.html'))) throw new Error(`no preview build in ${DIR}: run pnpm -C apps/hq preview:build first`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  let file = join(DIR, decodeURIComponent(path));
  if (!file.startsWith(DIR) || !existsSync(file) || !extname(file)) file = join(DIR, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

async function connect(port) {
  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { await sleep(300); }
  }
  if (!list) throw new Error('chrome did not open its debugging port');
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  };
  const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return { ws, send, evaluate, errors };
}

// the control on screen, not its twin behind the session surface: the room composer stays mounted
const VIS = `const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); if (!r.width) return false; const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!at && (el.contains(at) || at.classList.contains('projmenu-scrim')); };`;
const visText = (sel) => `(() => { ${VIS} return [...document.querySelectorAll('${sel}')].filter(vis).map((c) => c.innerText.replace(/\\s+/g, ' ').trim()); })()`;
const clickVis = (sel) => `(() => { ${VIS} const el = [...document.querySelectorAll('${sel}')].find(vis); if (!el) return false; el.click(); return true; })()`;
const closeMenus = `(() => { document.querySelectorAll('.projmenu-scrim').forEach((s) => s.click()); return true; })()`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const HTTP = `http://127.0.0.1:${server.address().port}`;
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'nm-model-chips-'));
  const proc = spawn('/usr/bin/arch', ['-arm64', CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1440,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  const { ws, send, evaluate, errors } = await connect(port);
  const until = async (expr, label, ms = 30_000) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await evaluate(expr).catch(() => null);
      if (v && !(Array.isArray(v) && v.length === 0)) return v;
      if (Date.now() > end) {
        const r = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
        if (r?.result?.data) writeFileSync(join(tmpdir(), 'capture-model-chips-failed.png'), Buffer.from(r.result.data, 'base64'));
        throw new Error(`never held: ${label} (page errors: ${errors.slice(-3).join(' | ') || 'none'})`);
      }
      await sleep(300);
    }
  };
  const check = (ok, what) => { if (!ok) throw new Error(`claim failed: ${what}`); say(`ok  ${what}`); };
  const still = () => evaluate(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:.001s!important;animation-delay:0s!important;transition:none!important}'; document.head.appendChild(s); return true; })()`);
  const shot = async (name) => {
    await still(); await sleep(350);
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, name), Buffer.from(r.result.data, 'base64'));
    say(`shot ${name}`);
  };
  const open = async (query) => {
    await send('Page.navigate', { url: `${HTTP}/index.html?${query}` });
    await until(`document.readyState === 'complete' && !!document.querySelector('nav')`, 'the shell painted', 60_000);
  };
  const facts = {};
  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
    for (const [theme, tag] of THEMES) {
      const f = (facts[tag] = {});
      // D1 · the conversation composer: the model of the agent it talks to, the agent beside Send
      await open(`theme=${theme}&openConvo=dev::Sprint%20priorities`);
      const [model0] = await until(visText('.sessionsurf .cchip.cmodel'), 'the model chip in the conversation');
      const [agent0] = await until(visText('.sessionsurf .cchip.cagent'), 'the agent chip in the conversation');
      check(/^Claude Sonnet 5 ?· High/.test(model0) && /^rex/.test(agent0), `${tag}: the chips read rex on Claude Sonnet 5 at High (${model0} | ${agent0})`);
      check(!(await evaluate(`!!document.querySelector('.brainchip, .bpill')`)), `${tag}: no brain chip in the composer`);
      await shot(`model-composer-${tag}.png`);
      // D2 · the model menu: the house brain, then each provider in its state
      check(await evaluate(clickVis('.sessionsurf .cchip.cmodel')), `${tag}: the model chip opens`);
      const provs = await until(`[...document.querySelectorAll('.cmodpop .cmodprov')].map((p) => p.innerText.replace(/\\s+/g, ' ').trim())`, 'the provider groups');
      f.providers = provs;
      check(provs.length === 3 && /Claude ready/i.test(provs[0]) && /ChatGPT ready/i.test(provs[1]) && /Gemini Sign in/i.test(provs[2]), `${tag}: Claude and ChatGPT ready, Gemini asks for a sign-in (${provs.join(' | ')})`);
      check(/NeuraMesh brain/.test(await evaluate(`document.querySelector('.cmodpop .cmodgroup .cmodpick')?.textContent`)), `${tag}: the NeuraMesh brain leads the list`);
      check(/rex uses this model from your next message/.test(await evaluate(`document.querySelector('.cmodpop .cmachfoot')?.textContent`)), `${tag}: the foot says when the pick starts`);
      await shot(`model-menu-${tag}.png`);
      // the thinking level, under the row, and the pick lands as the person's own
      check(await evaluate(`(() => { const r = [...document.querySelectorAll('.cmodpop .cmodrow')].find((x) => /Claude Opus 5/.test(x.textContent)); r?.querySelector('.cmodchev')?.click(); return !!r; })()`), `${tag}: Opus 5 opens its levels`);
      await until(`!!document.querySelector('.cmodpop .cmodlv')`, 'the levels row');
      await shot(`model-thinking-${tag}.png`);
      check(await evaluate(`(() => { const b = [...document.querySelectorAll('.cmodpop .cmodlv button')].find((x) => x.textContent.trim() === 'Low'); b?.click(); return !!b; })()`), `${tag}: Low picked for Opus 5`);
      const [model1] = await until(`(() => { const t = ${visText('.sessionsurf .cchip.cmodel')}; return t[0] && /Opus/.test(t[0]) ? t : null; })()`, 'the chip follows the pick');
      check(/^Claude Opus 5 ?· Low/.test(model1), `${tag}: the chip reads the pick (${model1})`);
      // D3 · the agent menu: every agent with the model it runs for this person
      check(await evaluate(clickVis('.sessionsurf .cchip.cagent')), `${tag}: the agent chip opens`);
      const rows = await until(`[...document.querySelectorAll('.cagpop .cagrow')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`, 'the agent rows');
      f.agents = rows;
      check(/^rex main orchestrator Opus 5 · Low/i.test(rows[0] ?? ''), `${tag}: rex leads as the main agent on the pick (${rows[0]})`);
      check(rows.some((r) => /^iris .*Opus 5 · Medium/.test(r)) && rows.some((r) => /^scout .*NeuraMesh brain/.test(r)), `${tag}: the crew shows each agent's model for this person`);
      check(await evaluate(`!!document.querySelector('.cagpop .cagnew')`), `${tag}: New agent sits at the foot`);
      await shot(`agent-menu-${tag}.png`);
      // D4 · one agent's model, from its row
      check(await evaluate(`(() => { const r = [...document.querySelectorAll('.cagpop .cagrow')].find((x) => /^\\s*iris/.test(x.textContent)); r?.querySelector('.cagmodel')?.click(); return !!r; })()`), `${tag}: iris's model opens`);
      const back = await until(`document.querySelector('.cagpop .cmodback')?.innerText.replace(/\\s+/g, ' ').trim()`, 'the role model view');
      check(/iris · designer/.test(back), `${tag}: the list names whose model it is (${back})`);
      await shot(`agent-role-model-${tag}.png`);
      await evaluate(`(() => { document.querySelector('.cagpop .cmodback')?.click(); return true; })()`);
      // D5 · New agent, in the menu's own body
      check(await evaluate(`(() => { const b = document.querySelector('.cagpop .cagnew'); b?.click(); return !!b; })()`), `${tag}: New agent opens`);
      const fields = await until(`[...document.querySelectorAll('.cagpop .cagfld > span:first-child')].map((s) => s.textContent.trim())`, 'the new agent form');
      check(['Name', 'What it does', 'Role', 'Model', 'Room'].every((x) => fields.includes(x)), `${tag}: the form asks name, what it does, role, model and room (${fields.join(', ')})`);
      check(!(await evaluate(`!!document.querySelector('.cagpop select')`)), `${tag}: no raw select in the menu (docs/33)`);
      await shot(`agent-new-${tag}.png`);
      await evaluate(closeMenus);
      // who answers: iris, and the model chip follows her; Send names her
      await evaluate(clickVis('.sessionsurf .cchip.cagent'));
      await until(`!!document.querySelector('.cagpop .cagrow')`, 'the agent rows again');
      await evaluate(`(() => { const r = [...document.querySelectorAll('.cagpop .cagrow')].find((x) => /^\\s*iris/.test(x.textContent)); r?.querySelector('.cagpick')?.click(); return true; })()`);
      const [agent2] = await until(`(() => { const t = ${visText('.sessionsurf .cchip.cagent')}; return t[0] && /iris/.test(t[0]) ? t : null; })()`, 'iris answers');
      const [model2] = await until(visText('.sessionsurf .cchip.cmodel'), 'the model chip for iris');
      check(/^iris/.test(agent2) && /^Claude Opus 5 ?· Medium/.test(model2), `${tag}: picking iris retargets the model chip (${agent2} | ${model2})`);
      const sent = await evaluate(`(async () => {
        window.__sent = []; const orig = window.nm.send; window.nm.send = (...a) => { window.__sent.push(a[1]); return orig.apply(window.nm, a); };
        const ta = [...document.querySelectorAll('.tcompose textarea')].find((t) => t.getBoundingClientRect().width > 0);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'Sketch the settings page.'); ta.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.tcompose .tsend')].find((b) => b.getBoundingClientRect().width > 0)?.click();
        await new Promise((r) => setTimeout(r, 500)); return window.__sent[0] ?? null; })()`);
      f.sent = sent;
      check(sent === '@iris Sketch the settings page.', `${tag}: Send names the picked agent (${sent})`);
      // an automation's session: the NeuraMesh brain, said in the menu
      await open(`theme=${theme}&openConvo=dev::Morning%20dependency`);
      const [model3] = await until(visText('.sessionsurf .cchip.cmodel'), 'the model chip in the routine session');
      check(/^NeuraMesh brain/.test(model3), `${tag}: the routine session runs on the NeuraMesh brain (${model3})`);
      await evaluate(clickVis('.sessionsurf .cchip.cmodel'));
      const foot = await until(`document.querySelector('.cmodpop .cmachfoot')?.textContent.trim()`, 'the automation foot');
      check(foot === 'Automations run on the NeuraMesh brain.' && (await evaluate(`document.querySelectorAll('.cmodpop .cmodprov').length`)) === 0, `${tag}: the menu says why, and offers no other model (${foot})`);
      await shot(`model-automation-${tag}.png`);
      // D12 · New session: the model with the knobs, the agent beside Send
      await open(`theme=${theme}`);
      await until(`!!document.querySelector('.hsend')`, 'the New session composer');
      const homeChips = await until(`(() => { const row = document.querySelector('.hsend')?.parentElement; if (!row) return null; const m = row.querySelector('.cchip.cmodel'); const a = row.querySelector('.cchip.cagent'); return m && a ? [m.textContent.trim(), a.textContent.trim(), a.closest('.cchips').nextElementSibling === document.querySelector('.hsend')] : null; })()`, 'both chips on the New session row');
      check(/Claude Sonnet 5/.test(homeChips[0]) && /rex/.test(homeChips[1]) && homeChips[2] === true, `${tag}: New session carries the model chip and the agent chip beside Send (${homeChips.slice(0, 2).join(' | ')})`);
      await shot(`model-new-session-${tag}.png`);
      // D11 · Settings › Models: each agent's model and level, then the providers
      await until(`(() => { const i = [...document.querySelectorAll('button.pfnew')].find((b) => /Settings/.test(b.textContent || '')); if (i) { i.click(); return true; } document.querySelector('.navwsmain')?.click(); return false; })()`, 'the workspace menu');
      await until(`(() => { const t = [...document.querySelectorAll('.wstab')].find((b) => b.textContent.trim() === 'Models'); t?.click(); return !!t; })()`, 'the Models tab');
      const table = await until(`[...document.querySelectorAll('.modtr:not(.th)')].map((r) => r.innerText.replace(/\\s+/g, ' ').trim())`, 'the agents table');
      f.settings = table;
      check(/^rex main orchestrator Claude Sonnet 5 · High/i.test(table[0] ?? '') && table.some((r) => /^scout .*NeuraMesh brain.*Not offered/i.test(r)), `${tag}: the table shows each agent's model and level for this person`);
      check((await evaluate(`[...document.querySelectorAll('.modprov')].map((p) => p.textContent)`)).length === 4, `${tag}: four providers, the house brain first`);
      await shot(`settings-models-${tag}.png`);
      // a row's model takes the table's place, and the pick lands back on the table
      check(await evaluate(`(() => { const b = [...document.querySelectorAll('.modtr:not(.th)')].find((r) => /^\\s*patch/.test(r.innerText))?.querySelector('.cmodpill'); b?.click(); return !!b; })()`), `${tag}: patch's model opens`);
      const editHead = await until(`document.querySelector('.modedit .cmodback')?.innerText.replace(/\\s+/g, ' ').trim()`, 'the model list in the table place');
      check(/patch · developer/.test(editHead) && !(await evaluate(`!!document.querySelector('.modtr')`)), `${tag}: the list replaces the table (${editHead})`);
      await shot(`settings-models-edit-${tag}.png`);
      await evaluate(`(() => { const r = [...document.querySelectorAll('.modedit .cmodrow')].find((x) => /GPT-5.6 Terra/.test(x.innerText)); r?.querySelector('.cmodpick')?.click(); return true; })()`);
      const patchRow = await until(`(() => { const r = [...document.querySelectorAll('.modtr:not(.th)')].find((x) => /^\\s*patch/.test(x.innerText)); return r && /Terra/.test(r.innerText) ? r.innerText.replace(/\\s+/g, ' ').trim() : null; })()`, 'the pick back on the table');
      check(/GPT-5.6 Terra · Medium/.test(patchRow), `${tag}: the pick starts at Medium (${patchRow})`);
      // D9 · onboarding's Team step: the main agent's model and level, then the crew
      await send('Page.navigate', { url: `${HTTP}/index.html?theme=${theme}&screen=onboard&to=3` });
      await until(`!!document.querySelector('.obbody button.obbrainmode')`, 'the Keys step', 60_000);
      await evaluate(`(() => { document.querySelector('.obbody button.obbrainmode')?.click(); return true; })()`);
      await sleep(250);
      await evaluate(`(() => { [...document.querySelectorAll('.obnav .btn.primary')].find((b) => /Continue/.test(b.textContent || ''))?.click(); return true; })()`);
      const opts = await until(`[...document.querySelectorAll('.obmopt')].map((o) => (o.classList.contains('on') ? '* ' : '') + o.innerText.replace(/\\s+/g, ' ').trim())`, 'the Team step');
      f.onboarding = opts;
      check(opts.some((o) => /^\* Claude Sonnet 5 ?Your Claude plan/.test(o)) && opts.some((o) => /NeuraMesh brain ?On credits/.test(o)), `${tag}: rex starts on the plan's model, the house brain beside it`);
      const crewModels = await evaluate(`[...document.querySelectorAll('.obcrewcard .obmmodel')].map((m) => m.textContent.trim())`);
      check(crewModels.length >= 3 && crewModels.every((m) => !/NeuraMesh brain/.test(m)), `${tag}: the crew starts on the plan's models (${crewModels.join(', ')})`);
      check((await evaluate(`[...document.querySelectorAll('.obmthink button.on')].map((b) => b.textContent.trim())`))[0] === 'Medium', `${tag}: thinking starts at Medium`);
      await shot(`onboarding-team-${tag}.png`);
    }
    writeFileSync(join(OUT, 'model-chips-facts.json'), JSON.stringify(facts, null, 2) + '\n');
    say(`EVIDENCE=PASS (${THEMES.length} themes)`);
  } finally {
    ws.close(); proc.kill(); server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
  }
}

main().catch((e) => { console.error(`[capture-model-chips] EVIDENCE=FAIL ${e.message}`); process.exit(1); });
