#!/usr/bin/env node
// THE BROWSER LANE CHECK (round 6). It attaches to nm-relay as one person (a relay token, as the hq
// gateway mints it), opens the machine's browser pane, and drives it:
//
//   1. the machine serves the browser lane, and a person pane opens with a state
//   2. a public page loads (straight out of the box): the title, loading done, a screencast frame
//   3. a click and typed text reach the page (a form whose result page names what was typed)
//   4. a dev-server PREVIEW: a server started in the agent box (through a box terminal) opens in the
//      pane at http://localhost:<port>. Only a Chromium that runs in the box shares that loopback
//   5. Chromium runs in the box: the box terminal sees its process, its env holds no machine token and
//      no boot credential, and the box egress reaches no metadata server, veth or private address (the
//      floor under a browser that goes direct)
//   6. the guard holds: the metadata server, the supervisor's veth IP, a low loopback port and a file
//      address are refused
//   7. the agent tab opens view only
//
//   NM_RELAY_URL         wss://<relay host>
//   NM_RELAY_TOKEN_KEY   the relay token key (base64url), as the hq gateway holds it
//   RELAY_USER_ID        the nm user (a member of the machine's workspace, the owner on a member machine)
//   RELAY_MACHINE_ID     the machine (awake, or waking: the attach retries 4404 for 90 s)
//   OUT                  where report.json and the frames go (default ./browser-lane-out)
//   BROWSER_SUPERVISOR=1 expect the old supervisor lane: checks 4 and 5 expect the opposite
//   BROWSER_WORKSPACE_ID with NM_API_URL, FLEET_SECRET, NM_ACTOR_SECRET: wake the machine first (as its
//                        user), and park it at the end
//
// Node 24, no dependencies. The report never holds the token. The pane helpers live in lib/relay.mjs,
// so other scripts (the evals' preview grading) drive the same pane:
//   const pane = await (await RelayConnection.open({...})).browser(); await pane.navigate(url); pane.jpeg()
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { RelayConnection } from './lib/relay.mjs';
import { Api } from './lib/api.mjs';

const URL_ = process.env.NM_RELAY_URL ?? '';
const KEY = process.env.NM_RELAY_TOKEN_KEY ?? '';
const USER = process.env.RELAY_USER_ID ?? '';
const MACHINE = process.env.RELAY_MACHINE_ID ?? '';
const OUT = resolve(process.env.OUT ?? 'browser-lane-out');
const SUPERVISOR = process.env.BROWSER_SUPERVISOR === '1';
if (!URL_ || !KEY || !USER || !MACHINE) {
  console.error('browser-lane: NM_RELAY_URL, NM_RELAY_TOKEN_KEY, RELAY_USER_ID and RELAY_MACHINE_ID are required');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 500 ? `${d.slice(0, 500)}…` : d}`);
};
// THE VISUAL EVIDENCE. Each saved JPEG is a frame of the PAINTED page (BrowserPane.painted: the frame is
// larger than the pane's own blank frame, else the pane is nudged to repaint, for up to 5 s), and its
// file name carries the step and the page title. frames.json lists every saved frame with its title, URL,
// byte size and whether it passed the painted test, and the report carries the same list
const frames = [];
let blankBytes = 0;
const slug = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'untitled';
async function saveFrame(pane, step) {
  const shot = await pane.painted({ blankBytes, minBytes: 8_000 });
  const title = pane.state?.title ?? '';
  const file = `${String(frames.length + 1).padStart(2, '0')}-${step}-${slug(title)}.jpg`;
  if (shot.jpeg) writeFileSync(join(OUT, file), shot.jpeg);
  const row = { step, file: shot.jpeg ? file : null, title, url: pane.state?.url ?? '', bytes: shot.bytes, blankBytes, painted: shot.painted, nudges: shot.tries };
  frames.push(row);
  writeFileSync(join(OUT, 'frames.json'), `${JSON.stringify(frames, null, 2)}\n`);
  console.log(`  frame ${file}  title="${title}" url=${row.url} bytes=${shot.bytes} painted=${shot.painted}`);
  return row;
}

// the preview server: plain node in the box. Its page is meant to be SEEN in a frame: a coloured page,
// a large heading with the nonce, and the form (its input covers the top-left corner, where the check
// clicks)
const nonce = randomBytes(4).toString('hex');
const PORT = 5173 + (parseInt(nonce.slice(0, 2), 16) % 200);
const STYLE = 'margin:0;background:#1e3a8a;color:#fff;font-family:sans-serif';
const serverJs = `require('http').createServer((q,s)=>{const u=new URL(q.url,'http://x');s.setHeader('content-type','text/html');`
  + `if(u.pathname==='/echo'){const v=(u.searchParams.get('q')||'').replace(/[^a-z0-9]/gi,'');s.end('<title>echo-'+v+'</title><body style=${STYLE}><h1 style=font-size:64px;padding:40px>You typed: '+v+'</h1><p style=font-size:32px;padding-left:40px>served from the agent box on port ${PORT}</p></body>');return}`
  + `s.end('<title>nm-preview-${nonce}</title><body style=${STYLE}><form action=/echo><input id=q name=q autofocus style=position:absolute;left:0;top:0;width:400px;height:60px;font-size:30px></form><h1 style=font-size:64px;padding-top:120px;padding-left:40px>NeuraMesh preview ${nonce}</h1><p style=font-size:32px;padding-left:40px>a dev server in the agent box, port ${PORT}</p></body>')}).listen(${PORT},'0.0.0.0')`;

let relay = null;
let report = {};
const WS = process.env.BROWSER_WORKSPACE_ID ?? '';
const api = WS && process.env.NM_API_URL ? new Api({ url: process.env.NM_API_URL, fleetSecret: process.env.FLEET_SECRET ?? '', actorSecret: process.env.NM_ACTOR_SECRET ?? '' }) : null;
try {
  if (api) {
    const m = await api.machine(MACHINE);
    if (m.desired_replicas !== 1) await api.as(USER).post('/v1/machines/wake', { workspace: WS, machineId: MACHINE });
    const up = await api.running(MACHINE);
    check('the machine is awake on the current image (woken by its user)', true, { epoch: up.epoch, size: up.size_class });
  }
  relay = await RelayConnection.open({ url: URL_, key: KEY, user: USER, machine: MACHINE });
  check('the relay attaches and the machine serves the browser lane', relay.lanes.has('browser'), [...relay.lanes]);

  const pane = await relay.browser({ tab: 'person', width: 1024, height: 768 });
  check('a person pane opens with a state', !!pane.state, pane.state);
  // the blank baseline for the painted test: the pane's own about:blank frame at this viewport
  for (let i = 0; i < 30 && !pane.frame; i++) await new Promise((r) => setTimeout(r, 100));
  blankBytes = pane.jpeg()?.length ?? 0;

  const pub = await pane.navigate('https://example.com/');
  const pubShot = await saveFrame(pane, 'public');
  check('a public page loads (title, loaded, a painted frame)', pub.ok && pub.state?.title === 'Example Domain' && pubShot.painted,
    { ok: pub.ok, title: pub.state?.title, url: pub.state?.url, frame: pubShot, notice: pub.notice });

  // the box terminal starts the preview server (the box has node; it has no python)
  const term = await relay.terminal();
  const started = await term.run(`(node -e ${JSON.stringify(serverJs).replace(/\$/g, '\\$')} >/tmp/nm-preview-${nonce}.log 2>&1 &) ; sleep 1; curl -s -m 3 http://127.0.0.1:${PORT}/ | grep -c nm-preview-${nonce}`);
  check('a dev server starts in the agent box (through a box terminal)', started.code === 0 && /^\s*1\s*$/m.test(started.out), started);

  const prev = await pane.navigate(`http://localhost:${PORT}/`);
  const prevShot = await saveFrame(pane, 'preview');
  const previewOk = prev.ok && prev.state?.title === `nm-preview-${nonce}`;
  if (SUPERVISOR) check('(supervisor lane) the preview is refused: the box loopback is out of reach', !previewOk, prev);
  else check('a dev-server preview opens in the pane at http://localhost (Chromium shares the box loopback), painted', previewOk && prevShot.painted, { ok: prev.ok, title: prev.state?.title, notice: prev.notice, frame: prevShot });

  if (previewOk) {
    // the input field covers the top-left corner: a click focuses it, typed text goes in, Enter submits
    await pane.click(100, 30);
    pane.type(`hello${nonce}`);
    await new Promise((r) => setTimeout(r, 500));
    pane.send({ t: 'key', type: 'down', key: 'Enter', code: 'Enter', keyCode: 13 });
    pane.send({ t: 'key', type: 'up', key: 'Enter', code: 'Enter', keyCode: 13 });
    let typed = null;
    for (let i = 0; i < 100 && !typed; i++) { await new Promise((r) => setTimeout(r, 150)); if (pane.state?.title === `echo-hello${nonce}`) typed = pane.state; }
    const typedShot = await saveFrame(pane, 'typed');
    check('a click and typed text reach the page (the form posts what was typed)', !!typed, { state: typed ?? pane.state, frame: typedShot });
  }

  // where Chromium runs: the box sees its process, and that process holds no machine secret
  const ps = await term.run(`for p in $(pgrep -f remote-debugging-pipe); do echo "PID $p $(tr '\\0' '\\n' </proc/$p/environ 2>/dev/null | grep -cE '^NM_(MACHINE_TOKEN|BOOT_CREDENTIAL)=')"; done | head -5`);
  const pids = [...ps.out.matchAll(/^PID (\d+) (\d+)/gm)].map((m) => ({ pid: Number(m[1]), secrets: Number(m[2]) }));
  if (SUPERVISOR) check('(supervisor lane) no Chromium process in the box', pids.length === 0, pids);
  else check('Chromium runs in the agent box, and its env holds no machine token or boot credential', pids.length > 0 && pids.every((p) => p.secrets === 0), { pids, out: ps.out.slice(0, 300) });
  // the box browser goes direct (no proxy): the box's own egress must reach only the public internet.
  // BROWSER_PRIVATE_PROBES: host/port pairs that must be closed (the sandbox's Cloud SQL private IP)
  const probes = ['169.254.169.254/80', '172.20.0.1/80', ...(process.env.BROWSER_PRIVATE_PROBES ?? '10.37.80.3/5432').split(',').filter(Boolean)];
  const floor = await term.run(probes.map((t) => `if timeout 4 bash -c "exec 3<>/dev/tcp/${t}" 2>/dev/null; then echo "FL""OOR ${t} open"; else echo "FL""OOR ${t} closed"; fi`).join('; '), 60_000);
  const open = [...floor.out.matchAll(/^FLOOR (\S+) open/gm)].map((m) => m[1]);
  const seen = [...floor.out.matchAll(/^FLOOR (\S+) (open|closed)/gm)].length;
  check('the box egress reaches no metadata server, no veth and no private address (the floor under a direct browser)', seen === probes.length && open.length === 0, { probes, open, out: floor.out.slice(0, 300) });
  term.close();

  for (const [what, url] of [['the metadata server', 'http://169.254.169.254/computeMetadata/v1/'], ['the supervisor veth IP', 'http://172.20.0.1:8080/'],
    ['a low loopback port', 'http://localhost:22/'], ['a file address', 'file:///proc/1/environ']]) {
    const r = await pane.navigate(url, 20_000);
    check(`the guard refuses ${what}`, !r.ok && !!r.notice && r.state?.url !== url, { notice: r.notice, url: r.state?.url });
  }
  pane.close();

  const agent = await relay.browser({ tab: 'agent', width: 800, height: 600 });
  check('the agent tab opens view only (idle until an agent drives it)', agent.state?.tab === 'agent', agent.state);
  agent.close();
} catch (e) {
  check('the browser lane check ran to the end', false, String(e?.message ?? e));
} finally {
  relay?.close();
  if (api && process.env.NM_KEEP_AWAKE !== '1') {
    try { const p = await api.park(MACHINE); console.log(`  parked ${MACHINE} at epoch ${p.epoch}`); } catch (e) { console.log(`  WARN the machine did not park: ${e.message}`); }
  }
}
report = { relay: URL_, machine: MACHINE, seconds: at(), port: PORT, nonce, checks, frames };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
