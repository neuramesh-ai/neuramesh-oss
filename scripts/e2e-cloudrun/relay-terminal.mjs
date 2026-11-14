// THE RELAY TERMINAL CHECK (infra/images/hq/README.md). It attaches to nm-relay the way hq does (a
// relay token for one person, in the attach message), opens a browser terminal on a machine, and
// checks from inside the shell that it runs in the agent box and not in the Cloud Run supervisor:
//
//   0. the relay shards (gate A2): NM_RELAY_URL may be the shard list, and the check dials the
//      machine's shard by the one rule (packages/relay/src/shard.ts). With two or more shards, another
//      shard refuses the attach with 4421 and names this machine's shard, and the URL it names takes
//      the attach. RELAY_WRONG_SHARD=0 skips it
//   1. the attach is accepted, and the terminal opens with a prompt
//   2. the shell has the box env: no machine token, TERM set, the cwd under /work
//   3. the box's PID 1 is not machined: no NM_BOOT_CREDENTIAL or NM_MACHINE_TOKEN in /proc/1/environ
//   4. the metadata server is not reachable from the shell
//   5. the size rides in at open, and a resize reaches the PTY
//   6. a session outlives its socket (the session round): the browser socket closes while the shell
//      works, a new socket takes the terminal back with a resume open, the output from while it was
//      down arrives, and what the shell exported is still set. Only on a machine whose `attached`
//      lanes name `resume`, and RELAY_RESUME=0 skips it
//   7. a close ends the shell: a second terminal finds only its own PTY file in the box
//
// Every marker is typed split in two ("EN""V[...") because the terminal echoes the typed command
// line: an unsplit marker would match the echo instead of the shell's output.
//
//   NM_RELAY_URL            wss://<relay host>, or the relay shards as a comma list in shard order
//   NM_RELAY_TOKEN_KEY      the key of the relay token (base64url), as the hq gateway holds it
//   RELAY_USER_ID           the nm user the token names (a member of the machine's workspace)
//   RELAY_MACHINE_ID        the machine to open the terminal on (it must be awake and on the relay)
//   OUT                     where report.json goes (default ./relay-terminal-out)
//   RELAY_RESUME            0 skips check 6 (default: run it)
//   RELAY_WRONG_SHARD       0 skips check 0 (default: run it when there are two shards or more)
//
// Node 24 (its WebSocket, and its type stripping for the one shard rule), no dependencies. The report
// never holds the token.
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
// THE ONE SHARD RULE, imported, never copied: a copy that drifted would send this check to a shard
// the machine is not on, and the check would blame the relay
import { parseRelayShards, parseWrongShard, shardIndexFor, WRONG_SHARD_CLOSE, wrongShardTarget } from '../../packages/relay/src/shard.ts';

const SHARDS = parseRelayShards(process.env.NM_RELAY_URL ?? '');
const MACHINE_ID = process.env.RELAY_MACHINE_ID ?? '';
const SHARD = shardIndexFor(MACHINE_ID, SHARDS.length);
const URL_ = SHARDS[SHARD] ?? '';
const KEY = process.env.NM_RELAY_TOKEN_KEY ?? '';
const USER = process.env.RELAY_USER_ID ?? '';
const MACHINE = MACHINE_ID;
const OUT = resolve(process.env.OUT ?? 'relay-terminal-out');
if (!URL_ || !KEY || !USER || !MACHINE) {
  console.error('relay-terminal: NM_RELAY_URL, NM_RELAY_TOKEN_KEY, RELAY_USER_ID and RELAY_MACHINE_ID are required');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** the same token the hq gateway mints (gateway.mjs signRelayToken) */
function relayToken(sub, key, ttl = 600) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'nm-hq-relay' }))}.${b64url(JSON.stringify({ sub, aud: 'nm-relay', iat: now, exp: now + ttl }))}`;
  return `${input}.${b64url(createHmac('sha256', Buffer.from(key, 'base64url')).update(input).digest())}`;
}

const t0 = Date.now();
const at = () => Number(((Date.now() - t0) / 1000).toFixed(1));
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) });
  const d = detail === undefined ? '' : `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${d.length > 500 ? `${d.slice(0, 500)}…` : d}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`== relay terminal check: ${URL_}, machine ${MACHINE}${SHARDS.length > 1 ? ` (shard ${SHARD} of ${SHARDS.length})` : ''}`);
const ch = `smoke-${randomBytes(4).toString('hex')}`;
let out = '';
let attached = null;
let closedByMachine = false;
let socketClose = null;
// the bytes of the terminal this client has: a resume open says how many (check 6)
let received = 0;
let resumed = null;
/** the socket in use: check 6 replaces it */
let ws = null;
function wire(sock) {
  sock.addEventListener('message', (ev) => {
    if (sock !== ws) return;
    let m;
    try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.t === 'attached') attached = m;
    else if (m.ch === ch && m.t === 'data' && typeof m.d === 'string') {
      // a machine that resumes names the offset of every frame: each byte is kept once
      const bytes = Buffer.from(m.d, 'base64');
      const at0 = typeof m.o === 'number' ? m.o : received;
      const seen = Math.max(0, received - at0);
      if (seen < bytes.length) { out += bytes.subarray(seen).toString('utf8'); received = at0 + bytes.length; }
    } else if (m.ch === ch && m.t === 'resumed') resumed = m;
    else if (m.ch === ch && m.t === 'close') closedByMachine = true;
  });
  sock.addEventListener('close', (ev) => { if (sock === ws) socketClose = { code: ev.code, reason: ev.reason, at: at() }; });
}
/** a new socket, attached the way hq attaches: null when the relay did not accept it */
async function dialAndAttach() {
  const sock = new WebSocket(URL_);
  ws = sock; attached = null; socketClose = null;
  wire(sock);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('the socket did not open')), { once: true }); });
  send({ t: 'attach', machineId: MACHINE, token: relayToken(USER, KEY) });
  for (let i = 0; i < 100 && !attached && !socketClose; i++) await sleep(100);
  return attached;
}
const send = (m) => ws.send(JSON.stringify(m));
const type = (s) => send({ ch, t: 'data', d: Buffer.from(s).toString('base64') });
/** wait for `re` in the output after `from`; returns the match or null */
async function waitFor(re, from, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const m = re.exec(out.slice(from));
    if (m) return m;
    if (socketClose) return null;
    await sleep(100);
  }
  return null;
}

/** one attach on `url` on a socket of its own: how the relay answered it (attached, or the close) */
async function probeAttach(url) {
  const sock = new WebSocket(url);
  const answer = await new Promise((res) => {
    const done = (v) => { clearTimeout(timer); res(v); };
    const timer = setTimeout(() => done({ timeout: true }), 15_000);
    sock.addEventListener('open', () => sock.send(JSON.stringify({ t: 'attach', machineId: MACHINE, token: relayToken(USER, KEY) })), { once: true });
    sock.addEventListener('message', (ev) => { try { const m = JSON.parse(String(ev.data)); if (m.t === 'attached') done({ attached: true, lanes: m.lanes }); } catch { /* not json */ } });
    sock.addEventListener('close', (ev) => done({ code: ev.code, reason: ev.reason }));
  });
  try { sock.close(1000, 'probe'); } catch { /* closed */ }
  return answer;
}

let report = {};
let wrongShard = null;
try {
  // 0. THE SHARDS: another shard refuses this machine and names its shard, and that URL takes the attach
  if (SHARDS.length < 2) console.log('  SKIP  a wrong shard refuses with the right one (one relay shard)');
  else if (process.env.RELAY_WRONG_SHARD === '0') console.log('  SKIP  a wrong shard refuses with the right one (RELAY_WRONG_SHARD=0)');
  else {
    const wrong = SHARDS[(SHARD + 1) % SHARDS.length];
    const refused = await probeAttach(wrong);
    const named = parseWrongShard(refused.reason);
    wrongShard = { dialled: wrong, answer: refused };
    check(`another shard refuses with ${WRONG_SHARD_CLOSE} and names this machine's shard (${SHARD} of ${SHARDS.length})`,
      refused.code === WRONG_SHARD_CLOSE && named?.index === SHARD && named?.count === SHARDS.length, refused);
    const target = wrongShardTarget(refused.reason, SHARDS, wrong);
    const there = target ? await probeAttach(target) : null;
    wrongShard.followed = { target, answer: there };
    check('the shard the refusal names takes the attach', !!there?.attached, { target, answer: there });
  }

  await dialAndAttach();
  check('the relay accepts the attach with a relay token', !!attached, attached ?? socketClose);
  if (!attached) throw new Error('not attached');
  check('the machine serves the terminal lane', !attached.lanes || attached.lanes.includes('terminal'), attached.lanes);

  send({ ch, t: 'open', cols: 100, rows: 30 });
  const prompt = await waitFor(/[#$] $/m, 0, 20_000);
  check('the terminal opens with a prompt', !!prompt, out.slice(-200));

  let from = out.length;
  type('echo "EN""V[${NM_MACHINE_TOKEN:-none}|${NM_BOOT_CREDENTIAL:-none}|$TERM|$PWD]"\r');
  const env = await waitFor(/ENV\[([^|\]]*)\|([^|\]]*)\|([^|\]]*)\|([^\]]*)\]/, from);
  check('the shell has the box env: no machine token, no boot credential, TERM set, cwd under /work',
    !!env && env[1] === 'none' && env[2] === 'none' && env[3] === 'xterm-256color' && env[4].startsWith('/work'),
    env ? { token: env[1] === 'none' ? 'absent' : 'PRESENT', boot: env[2] === 'none' ? 'absent' : 'PRESENT', term: env[3], cwd: env[4] } : out.slice(from, from + 300));

  from = out.length;
  type('echo "PI""D1[$(tr \'\\0\' \'\\n\' < /proc/1/environ 2>/dev/null | grep -cE \'^NM_(BOOT_CREDENTIAL|MACHINE_TOKEN)=\')|$(cat /proc/1/comm 2>/dev/null)]"\r');
  const pid1 = await waitFor(/PID1\[(\d+)\|([^\]]*)\]/, from);
  check("the box's PID 1 is not machined: no credential in /proc/1/environ", !!pid1 && pid1[1] === '0', pid1 ? { credentials: Number(pid1[1]), comm: pid1[2] } : out.slice(from, from + 300));

  from = out.length;
  type('if timeout 3 bash -c "exec 3<>/dev/tcp/169.254.169.254/80" 2>/dev/null; then echo "ME""TA[open]"; else echo "ME""TA[blocked]"; fi\r');
  const meta = await waitFor(/META\[(open|blocked)\]/, from, 10_000);
  check('the metadata server is not reachable from the shell', !!meta && meta[1] === 'blocked', meta?.[1] ?? out.slice(from, from + 300));

  from = out.length;
  type('echo "SI""ZE[$(stty size)]"\r');
  const size1 = await waitFor(/SIZE\[(\d+) (\d+)\]/, from);
  check('the size rides in at open (30 rows, 100 cols)', !!size1 && size1[1] === '30' && size1[2] === '100', size1 ? `${size1[1]} ${size1[2]}` : out.slice(from, from + 300));

  send({ ch, t: 'resize', cols: 120, rows: 40 });
  let size2 = null;
  for (let i = 0; i < 10 && !size2; i++) {
    await sleep(800);
    from = out.length;
    type('echo "SI""ZE[$(stty size)]"\r');
    const m = await waitFor(/SIZE\[(\d+) (\d+)\]/, from, 5_000);
    if (m && m[1] === '40' && m[2] === '120') size2 = m;
  }
  check('a resize reaches the PTY (40 rows, 120 cols)', !!size2, size2 ? `${size2[1]} ${size2[2]}` : out.slice(-300));

  // 6. A SESSION OUTLIVES ITS SOCKET. The shell exports a value and works on while this client's socket
  // closes; a new socket takes the terminal back with how many bytes this client has. The relay sees a
  // clean close here (a WebSocket cannot cut its own TCP connection), and that costs the session the same
  // as a cut: the relay detaches it on the machine
  const canResume = Array.isArray(attached.lanes) && attached.lanes.includes('resume');
  if (process.env.RELAY_RESUME === '0') console.log('  SKIP  a session outlives its socket (RELAY_RESUME=0)');
  else {
    check('the machine names the resume capability', canResume, attached.lanes);
    if (canResume) {
      from = out.length;
      type('export NMRESUME=42; sleep 4; echo "AF""TER[$NMRESUME]"\r');
      await sleep(1_500); // the shell has the line, and its output comes while no socket listens
      const old = ws;
      ws = null;
      old.close(4000, 'resume check');
      await sleep(4_500);
      const back = await dialAndAttach();
      check('a new socket attaches after the old one closed', !!back, back ?? socketClose);
      if (back) {
        resumed = null;
        const had = received;
        send({ ch, t: 'open', cols: 120, rows: 40, resume: true, from: had });
        for (let i = 0; i < 100 && !resumed && !closedByMachine && !socketClose; i++) await sleep(100);
        check('the machine takes the terminal back on the new socket, with nothing dropped',
          !!resumed && resumed.o === had && resumed.dropped === 0, resumed ?? { closedByMachine, socketClose });
        const late = await waitFor(/AFTER\[([^\]]*)\]/, from, 10_000);
        check('the output from while no socket listened arrives after the resume', !!late && late[1] === '42', late?.[1] ?? out.slice(from, from + 300));
        from = out.length;
        type('echo "RE""SUME[$NMRESUME]"\r');
        const same = await waitFor(/RESUME\[([^\]]*)\]/, from);
        check('the resumed shell is the same shell: what it exported is still set', !!same && same[1] === '42', same?.[1] ?? out.slice(from, from + 300));
      }
    }
  }

  // 7. the close: the shell ends, its exec ends, and the box files go (the relay does not hand a machine's
  // close back for a channel this client already released, so a second terminal looks instead)
  send({ ch, t: 'close' });
  await sleep(6_000);
  const ch2 = `${ch}-b`;
  const firstOut = out.length;
  const out2 = { text: '' };
  ws.addEventListener('message', (ev) => {
    try { const m = JSON.parse(String(ev.data)); if (m.ch === ch2 && m.t === 'data') out2.text += Buffer.from(m.d, 'base64').toString('utf8'); } catch { /* not ours */ }
  });
  send({ ch: ch2, t: 'open', cols: 80, rows: 24 });
  for (let i = 0; i < 200 && !/[#$] $/m.test(out2.text); i++) await sleep(100);
  send({ ch: ch2, t: 'data', d: Buffer.from('echo "TT""YS[$(ls /tmp/nm-term/*.tty 2>/dev/null | wc -l)]"\r').toString('base64') });
  let ttys = null;
  for (let i = 0; i < 100 && !ttys; i++) { ttys = /TTYS\[(\d+)\]/.exec(out2.text); if (!ttys) await sleep(100); }
  check('a close ends the shell: a second terminal finds only its own PTY file', !!ttys && ttys[1] === '1', ttys ? { ptyFiles: Number(ttys[1]) } : out2.text.slice(-300));
  check('the first terminal sent nothing after its close', out.length === firstOut, { bytesAfterClose: out.length - firstOut });
  send({ ch: ch2, t: 'close' });
  await sleep(500);
} catch (e) {
  check('the terminal check ran to the end', false, String(e?.message ?? e));
} finally {
  try { ws?.close(1000, 'done'); } catch { /* closed */ }
}
report = { relay: URL_, shards: SHARDS, shard: SHARD, wrongShard, machine: MACHINE, seconds: at(), checks, attached, resumed, socketClose, transcript: out.slice(-4000) };
writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
const failed = checks.filter((c) => !c.ok).length;
console.log(`== ${checks.length - failed} passed, ${failed} failed (${at()}s)`);
process.exit(failed ? 1 : 0);
