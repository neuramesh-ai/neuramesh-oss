// TENANCY (the 2026-09-21 cross-workspace leak class, credentials-authz.ts): a signed-in stranger
// who learns a workspace's ids must read nothing of it and write nothing into it. Ids are not
// secrets: they ride in URLs, logs, error bodies and shared artifacts. Every route a person uses
// in this suite is tried once as a stranger; any answer but a refusal is a finding.
import { randomUUID } from 'node:crypto';
import { api, cmd, feedRows, refusal } from './lib.mjs';

const H = (ctx) => ctx.a.userId;

export const tenancy = [
  {
    id: 'tenancy',
    title: 'a stranger with the workspace\'s ids reads nothing and writes nothing (tenancy)',
    async run(t, ctx) {
      const s = (await ctx.extraUser('tenant')).userId;
      const ws = ctx.ws.id;
      const ch = ctx.ws.channelId;
      const board = (await feedRows(H(ctx), 'whiteboards', ws))[0];
      const reads = {
        'GET /v1/invites': () => api('GET', `/v1/invites?workspace=${ws}`, { as: s }),
        'GET /v1/memory': () => api('GET', `/v1/memory?workspace=${ws}&channel=${ch}`, { as: s }),
        'POST /v1/recall': () => api('POST', '/v1/recall', { as: s, body: { workspace: ws, query: ctx.tag, k: 5 } }),
        'GET /v1/retro': () => api('GET', `/v1/retro?workspace=${ws}&range=week`, { as: s }),
        'GET /v1/model-packs': () => api('GET', `/v1/model-packs?workspace=${ws}`, { as: s }),
        'GET /v1/whiteboards': () => api('GET', `/v1/whiteboards?workspace=${ws}`, { as: s }),
        ...(board ? { 'GET /v1/whiteboards/:id': () => api('GET', `/v1/whiteboards/${board.id}`, { as: s }) } : {}),
        'GET /v1/credentials': () => api('GET', `/v1/credentials?workspace=${ws}`, { as: s }),
        'GET /v1/usage': () => api('GET', `/v1/usage?workspace=${ws}`, { as: s }),
        'GET /v1/parks': () => api('GET', `/v1/parks?workspace=${ws}`, { as: s }),
        ...(ctx.boardTask ? { 'GET /v1/tasks/:id': () => api('GET', `/v1/tasks/${ctx.boardTask.id}`, { as: s }) } : {}),
      };
      const out = {};
      for (const [k, f] of Object.entries(reads)) {
        out[k] = await f().then((j) => {
          // an empty answer is not a leak: say what came back
          const n = j?.invites?.length ?? j?.facts?.length ?? j?.hits?.length ?? j?.packs?.length ?? j?.whiteboards?.length ?? j?.credentials?.length ?? j?.parks?.length ?? (j?.agents ? j.agents.length : null);
          return n === 0 ? 'ok (empty)' : `ok: ${JSON.stringify(j).slice(0, 120)}`;
        }).catch((e) => e?.json?.code ?? `HTTP ${e.status}`);
      }
      const leaks = Object.entries(out).filter(([, v]) => /^ok:/.test(v));
      t.check('no read answers a stranger with the workspace\'s data', leaks.length === 0, out);
      const writes = {
        'POST /v1/messages': () => refusal(api('POST', '/v1/messages', { as: s, body: { workspace: ws, channel: ch, body: `stranger ${ctx.tag}` } })),
        'task.create': () => refusal(cmd(s, { type: 'task.create', workspace: ws, channel: ch, title: `stranger ${ctx.tag}` })),
        'memory.upsert_fact': () => refusal(cmd(s, { type: 'memory.upsert_fact', workspace: ws, channel: ch, content: `stranger fact ${ctx.tag}` })),
        'skill.create': () => refusal(cmd(s, { type: 'skill.create', workspace: ws, channel: ch, name: `stranger-${ctx.tag}`, description: 'x', scope: 'global', body: 'x' })),
        'whiteboard.create': () => refusal(cmd(s, { type: 'whiteboard.create', channel: ch, title: `stranger ${ctx.tag}`, mermaid: 'flowchart LR\n A-->B' })),
        'schedule.create': () => refusal(cmd(s, { type: 'schedule.create', channel: ch, title: `stranger ${ctx.tag}`, prompt: 'x', cadence: 'daily' })),
        'POST /v1/whiteboards': () => refusal(api('POST', '/v1/whiteboards', { as: s, body: { id: randomUUID(), workspace: ws, channel: ch, title: `stranger ${ctx.tag}`, rev: 1 } })),
        ...(board ? { 'PATCH /v1/whiteboards/:id': () => refusal(api('PATCH', `/v1/whiteboards/${board.id}`, { as: s, body: { rev: 999999, title: `stranger ${ctx.tag}` } })) } : {}),
        'POST /v1/artifacts': () => refusal(api('POST', '/v1/artifacts', { as: s, body: { id: randomUUID(), workspace: ws, channel: ch, messageId: randomUUID(), kind: 'file', name: 'x.txt', inlineContent: 'x' } })),
      };
      const w = {};
      for (const [k, f] of Object.entries(writes)) w[k] = await f();
      // a PATCH that "succeeds" with applied:false wrote nothing; look at the rows instead of the code
      const landed = {
        messages: (await feedRows(H(ctx), 'messages', ws)).filter((m) => (m.body ?? '').includes(`stranger ${ctx.tag}`)).length,
        tasks: (await feedRows(H(ctx), 'tasks', ws)).filter((x) => (x.title ?? '').includes(`stranger ${ctx.tag}`)).length,
        whiteboards: (await feedRows(H(ctx), 'whiteboards', ws)).filter((x) => (x.title ?? '').includes(`stranger ${ctx.tag}`)).length,
        skills: (await feedRows(H(ctx), 'skills', ws)).filter((x) => (x.name ?? '').includes(`stranger-${ctx.tag}`)).length,
        schedules: (await feedRows(H(ctx), 'schedules', ws)).filter((x) => (x.title ?? '').includes(`stranger ${ctx.tag}`)).length,
      };
      t.check('no write from a stranger lands in the workspace', Object.values(landed).every((n) => n === 0), { codes: w, landed });
    },
  },
];
