#!/usr/bin/env node
// seed.mjs: the perf-lab room the frame journeys run in, created through the control-api's own
// command path (so events, projections and the PowerSync publication stay correct).
//
//   node seed.mjs [--api http://127.0.0.1:8841] [--messages 400]
//
// Why a seeded room: the long threads that exist (task #1003, 439 messages) are task threads
// anchored to a conversation, and an anchored unit never earns a row, so no single click from Home
// opens one. A perf-lab conversation thread is a row on Home and in the rail, which is the journey.
//
// Content is REAL: message bodies copied from Acme Robotics' own rooms (read-only SQL), in their
// original order, so the markdown mix (headings, lists, code, tables, long agent replies) is the
// product's own. Card markers (‹…›) and nm fences (nmq/nms/nmauth) are left out, so no decision
// rows or needs-you items are minted; human @mentions are defused so no agent can be woken by them.
// Writes seed-created.md (git-ignored) next to this file with exactly what was created and how to
// delete it. SEED.md is the generic description.
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const WS = 'a0000000-0000-0000-0000-00000000000a';
const DEFAULT_PROJECT = 'd55ab306-1b49-4b71-b49f-1a20c0ae1882';
const DEV_USER = '00000000-0000-0000-0000-000000000001';
const REX = 'ba49f62a-3562-4bbb-a5ba-930259b1dc8c';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const API = arg('--api', 'http://127.0.0.1:8841');
const N = Number(arg('--messages', 400));

const human = { kind: 'human', id: DEV_USER };
const agentActor = (id) => ({ kind: 'agent', id });
const psql = (sql) => execFileSync('docker', ['exec', 'stack-pg-1', 'psql', '-U', 'postgres', '-d', 'nm', '-At', '-F', '\t', '-c', sql], { maxBuffer: 64 << 20 }).toString();

async function api(path, actor, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

async function main() {
  const existing = psql(`select id from channels where workspace_id='${WS}' and slug='perf-lab'`).trim();
  if (existing) throw new Error(`perf-lab already exists (${existing}); see seed-created.md, or delete it first`);
  const agents = new Set(psql(`select id from agents where workspace_id='${WS}' and retired_at is null`).trim().split('\n'));

  // 1. the room
  const ch = await api('/v1/commands', human, { type: 'channel.create', workspace: WS, project: DEFAULT_PROJECT, slug: 'perf-lab', topic: 'Performance harness data. Safe to delete.' });
  const channel = ch.channelId;
  console.log(`[seed] channel perf-lab ${channel}`);

  // 2. the bodies: every eligible Acme message in order, then an even sample of N
  const rows = psql(`select author_kind, author_id, replace(replace(encode(convert_to(body,'UTF8'),'base64'),chr(10),''),chr(13),'') from messages
    where workspace_id='${WS}' and length(body) between 1 and 12000 and body not like '%‹%' and body !~ '\`\`\`nm' order by created_at`).trim().split('\n')
    .map((l) => { const [kind, id, b64] = l.split('\t'); return { kind, id, body: Buffer.from(b64, 'base64').toString('utf8') }; });
  const step = rows.length / N;
  const picked = Array.from({ length: Math.min(N, rows.length) }, (_, i) => rows[Math.floor(i * step)]);
  // 3. the long thread
  const long = { id: randomUUID(), title: 'perf-lab · long thread' };
  const reply = { id: randomUUID(), title: 'perf-lab · reply target' };
  let posted = 0; let bytes = 0; let humans = 0;
  const t0 = Date.now();
  for (let i = 0; i < picked.length; i++) {
    const m = picked[i];
    const isHuman = m.kind === 'human';
    const actor = isHuman ? human : agentActor(agents.has(m.id) ? m.id : REX);
    // defuse mentions in human text: a woken agent would answer into the harness's thread
    const body = isHuman ? m.body.replace(/@([A-Za-z0-9_-]+)/g, '$1') : m.body;
    const id = randomUUID();
    await api('/v1/messages', actor, { id, workspace: WS, channel, body, threadId: long.id, ...(i === 0 ? { rootMessageId: id, threadMode: 'chat', threadOrigin: 'web' } : {}) });
    posted++; bytes += Buffer.byteLength(body); if (isHuman) humans++;
    if (i % 50 === 0) console.log(`[seed] long thread ${i}/${picked.length}`);
  }
  // the thread's last word is an agent's: nothing in it is waiting on anyone
  await api('/v1/messages', agentActor(REX), { workspace: WS, channel, body: 'That is the whole history for this thread. Nothing here is waiting on you.', threadId: long.id });
  posted++;
  await api('/v1/commands', human, { type: 'thread.update', workspace: WS, threadId: long.id, title: long.title });
  // 4. the reply target: a short conversation the reply-arrival journey posts into
  const convo = [
    [human, 'Can you give me the release checklist status for the web client?'],
    [agentActor(REX), 'Sure. The checklist has 12 items. 9 are done, 2 wait on review, 1 waits on a deploy note.'],
    [human, 'Which one waits on the deploy note?'],
    [agentActor(REX), 'The PowerSync re-snapshot. The PR that adds the new synced table must say it under Deploy notes.'],
    [human, 'OK. Show me the full plan when it is ready.'],
    [agentActor(REX), 'I will post the full plan in this thread.'],
  ];
  for (let i = 0; i < convo.length; i++) {
    const [actor, body] = convo[i];
    const id = randomUUID();
    await api('/v1/messages', actor, { id, workspace: WS, channel, body, threadId: reply.id, ...(i === 0 ? { rootMessageId: id, threadMode: 'chat', threadOrigin: 'web' } : {}) });
  }
  await api('/v1/commands', human, { type: 'thread.update', workspace: WS, threadId: reply.id, title: reply.title });
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  console.log(`[seed] done: long thread ${posted} messages (${humans} human, ${bytes} bytes), reply target ${convo.length} messages, ${secs}s`);

  const md = `# perf-lab seed data (Acme Robotics)

Created ${new Date().toISOString()} by \`harness/seed.mjs\` through the control-api command path
(\`POST /v1/commands\` and \`POST /v1/messages\` on ${API}, actor header, dev stack only).

| What | Id | Contents |
|---|---|---|
| Room \`#perf-lab\` (project Default \`${DEFAULT_PROJECT}\`) | \`${channel}\` | topic "Performance harness data. Safe to delete." |
| Thread "${long.title}" (chat mode) | \`${long.id}\` | ${posted} messages: ${picked.length} real Acme message bodies in their original order (${humans} human, the rest agent, ${bytes} bytes), then one closing agent line |
| Thread "${reply.title}" (chat mode) | \`${reply.id}\` | ${convo.length} short messages. **Every reply-arrival run appends one ~6 KB agent message here.** |

Body selection: every Acme message with 1 to 12,000 characters, no \`‹…›\` card marker and no
\`nm\` code fence (nmq, nms, nmauth), so no decision rows or needs-you items are minted, sampled evenly to ${picked.length}.
Human bodies are posted as the dev user \`${DEV_USER}\` with @mentions defused (\`@rex\` becomes \`rex\`).
Agent bodies keep their original agent id when it is a live Acme agent, else rex \`${REX}\`.

Effect on other measurements: the dev user's initial sync grows by about ${posted + convo.length} message ops
(~${Math.round(bytes / 1024)} KB of bodies). The load baseline was recorded AFTER this seed, so before and after
runs see the same data (plus the replies the reply-arrival journey appends).

## Delete it

One command (human-only, purges the room's messages and threads):

\`\`\`sh
curl -sS -X POST http://127.0.0.1:8841/v1/commands -H 'content-type: application/json' \\
  -H 'x-nm-actor: {"kind":"human","id":"${DEV_USER}"}' \\
  -d '{"type":"channel.delete","channel":"${channel}"}'
\`\`\`

(Any control-api on the dev stack with NM_ALLOW_ACTOR_HEADER=1 works. 8841 is the harness's.)
`;
  writeFileSync(resolve(here, 'seed-created.md'), md);
  writeFileSync(resolve(here, 'seed.json'), JSON.stringify({ workspace: WS, channel, longThread: long, replyThread: reply, longMessages: posted, longHuman: humans, longBytes: bytes, replyMessages: convo.length, createdAt: new Date().toISOString() }, null, 1));
  console.log('[seed] wrote seed-created.md + seed.json');
}

main().catch((e) => { console.error('[seed] FAILED', e); process.exit(1); });
