// THE r8 PROJECT MEMORY FEATURE (decision D15, docs/design/cloud-run-2026-10/project-memory.md), live.
// Rooms are gone: memory belongs to the project, and every agent of the project recalls it. On the
// starter brain nm-api refreshes the project block and distils facts (project-memory-refresh.ts).
// The scenario writes the way hq and a machine write (the same routes, as the same person or agent):
//   1. the wizard crew sits on the starter brain, so nm-api owns the refresh,
//   2. a person states a distinctive decision in one conversation of project A,
//   3. the refresh runs now (the e2e door: the cron's pass for this workspace, window wound back),
//      and project A has its project_summary block,
//   4. an agent in a DIFFERENT thread of project A (its Agent Desk home) recalls the decision,
//   5. an agent asking for project B does not get it,
//   6. hq's Memory view shows the project block.
import { randomUUID } from 'node:crypto';
import { agentActor, api, escapeRe, feedRows, seeText, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const code = (e) => e?.json?.code ?? (e?.status ? `HTTP ${e.status}` : String(e?.message ?? e).slice(0, 120));
const tryApi = (...a) => api(...a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, code: code(e), status: e?.status }));

/** the e2e door: the memory refresh pass for one workspace (e2e-routes.ts, NM_E2E_ROUTES=1) */
const refreshDoor = (ws, force) => tryApi('POST', `/internal/e2e/workspaces/${ws}/memory-refresh`, { fleet: true, body: { force }, timeout: 120_000 });
const memoryOf = (ctx, projectId) => api('GET', `/v1/memory?workspace=${ctx.ws.id}&channel=${encodeURIComponent(`project:${projectId}`)}`, { as: H(ctx) });
const recall = (ctx, actor, body) => tryApi('POST', '/v1/recall', { as: actor, body: { workspace: ctx.ws.id, k: 10, ...body } });
const bodies = (res) => (res.ok ? (res.r.hits ?? []).map((h) => String(h.body)) : []);

/** project A (the default) and a project B: an existing one, or one the person makes */
async function projects(t, ctx) {
  const rows = await feedRows(H(ctx), 'projects', ctx.ws.id);
  const a = rows.find((p) => Number(p.is_default) === 1 || p.is_default === true);
  let b = rows.find((p) => p.id !== a?.id && (p.status ?? 'active') !== 'archived');
  if (!b) {
    const made = await tryApi('POST', '/v1/commands', { as: H(ctx), body: { type: 'project.create', workspace: ctx.ws.id, name: `R8 memory B ${ctx.tag}` } });
    t.note({ projectB: made.ok ? 'made' : made.code });
    if (made.ok) b = await until('project B in the feed', async () => (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((p) => p.id === made.r.projectId), { timeout: 30_000 }).catch(() => null);
  }
  return { a, b };
}

export const r8Memory = [
  {
    id: 'project-memory',
    title: 'project memory (D15): the starter brain refreshes the project block, an agent in another thread of the project recalls a decision, another project never does',
    async run(t, ctx) {
      const ws = ctx.ws.id;
      const orch = ctx.ws.agents.find((a) => a.role === 'orchestrator');
      t.check('the wizard crew\'s orchestrator sits on the starter brain, so nm-api owns the refresh', /flash-lite/.test(orch?.model ?? ''), ctx.ws.agents.map((a) => `${a.name}:${a.role}:${a.model}`));
      const { a, b } = await projects(t, ctx);
      if (!a) t.skip('no default project');
      t.note({ projectA: a.id, projectB: b?.id ?? null });

      // 2. a decision stated in one conversation of project A
      const word = `kumquat${ctx.tag}`;
      const decision = `Decision for the record: the launch codename is ${word}, and Rex owns the launch checklist.`;
      const convo = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ws, channel: a.context_channel_id ?? ctx.ws.channelId, threadId: convo, body: decision } });
      t.note({ conversation: convo, word });

      // 3. the refresh, now: the cron's own pass for this workspace, the window wound back
      const t0 = Date.now();
      const door = await refreshDoor(ws, true);
      // a build without the door: the in-process cron (/internal/memory-refresh@600) is the refresh, and
      // a fresh project with no block is due at its next pass
      const viaCron = !door.ok && door.status === 404;
      const outA = door.ok ? door.r.outcomes.find((o) => o.project === a.id) : null;
      t.note({ door: door.ok ? door.r.outcomes : door.code, refresh: viaCron ? 'the cron pass (no e2e door on this build)' : 'the e2e door' });
      // the project block: projectBlock, or on an nm-api before that field, block (a fresh workspace has
      // no legacy channel summary, and the machine writes none any more)
      const own = (m) => (m.projectBlock !== undefined ? m.projectBlock : m.block);
      // a concurrent cron pass may hold the claim (lost_claim): then its own write is what lands
      const mem = await until('project A\'s project block, written after the decision', async () => {
        const m = await memoryOf(ctx, a.id);
        const pb = own(m);
        return pb && Date.parse(pb.updatedAt) >= t0 - 5_000 && pb.content.trim() ? m : null;
      }, { timeout: viaCron ? 720_000 : 120_000, every: viaCron ? 15_000 : 5_000 }).catch(() => null);
      const block = mem ? own(mem) : null;
      t.check('the refresh on the starter brain writes project A\'s project_summary block', !!block, { outcome: outA?.outcome ?? null, waitedS: Math.round((Date.now() - t0) / 1000), block: block ?? (await memoryOf(ctx, a.id).catch((e) => code(e))) });
      const summary = block?.content ?? '';
      t.check('the project block is the summary the memory view returns (block)', !!mem && mem.block?.content === summary, { block: mem?.block?.content?.slice(0, 200) ?? null, legacyBlocks: mem?.blocks?.length ?? null });
      const fact = (mem?.facts ?? []).find((f) => !f.validUntil && f.content.includes(word));
      t.check('the refresh distils the decision into a project fact', !!fact, { facts: (mem?.facts ?? []).filter((f) => !f.validUntil).map((f) => f.content).slice(0, 8) });
      t.note({ summary: summary.slice(0, 400) });

      // 4. an agent in a DIFFERENT thread of project A: the orchestrator's Agent Desk home
      const desk = await tryApi('POST', '/v1/team/open', { as: H(ctx), body: { workspace: ws, projectId: a.id } });
      const home = desk.ok ? (desk.r.homes ?? []).find((h) => h.home_agent_id === orch?.id) ?? desk.r.homes?.[0] : null;
      t.check('project A has an Agent Desk home thread, not the conversation', !!home && home.id !== convo, desk.ok ? { home: home?.id ?? null } : desk);
      const agent = agentActor(ctx, 'orchestrator');
      if (home) {
        const viaThread = await recall(ctx, agent, { threadId: home.id, query: `launch codename ${word}` });
        t.check('the agent recalls the decision from its home thread (/v1/recall, thread scope)', bodies(viaThread).some((x) => x.includes(word)), viaThread.ok ? { hits: viaThread.r.hits.map((h) => `${h.kind}: ${String(h.body).slice(0, 120)}`) } : viaThread);
        const team = await tryApi('GET', `/v1/team/recall?workspace=${ws}&threadId=${home.id}&query=${encodeURIComponent(`launch codename ${word}`)}`, { as: agent });
        const teamHits = team.ok ? [...(team.r.hits ?? []), ...(team.r.facts ?? [])].map((h) => String(h.body)) : [];
        t.check('the Agent Desk recall tool finds it too (/v1/team/recall: messages and project facts)', teamHits.some((x) => x.includes(word)), team.ok ? { hits: (team.r.hits ?? []).length, facts: (team.r.facts ?? []).map((f) => String(f.body).slice(0, 120)) } : team);
      }
      const noScope = await recall(ctx, agent, { query: `launch codename ${word}` });
      t.check('an agent with no scope (an old machine) reads its own project and finds it', bodies(noScope).some((x) => x.includes(word)), noScope.ok ? { hits: noScope.r.hits.length } : noScope);

      // 5. project B never gets it
      if (!b) {
        t.note('no project B (the plan refused a second project): the cross-project check did not run');
      } else {
        const viaProject = await recall(ctx, agent, { project: b.id, query: `launch codename ${word}` });
        t.check('an agent asking for project B does not get project A\'s decision', viaProject.ok && !bodies(viaProject).some((x) => x.includes(word)), viaProject.ok ? { hits: bodies(viaProject).map((x) => x.slice(0, 120)) } : viaProject);
        if (b.context_channel_id) {
          const viaChannel = await recall(ctx, agent, { channel: b.context_channel_id, query: word });
          t.check('nor through a channel of project B', viaChannel.ok && !bodies(viaChannel).some((x) => x.includes(word)), viaChannel.ok ? { hits: viaChannel.r.hits.length } : viaChannel);
        }
        const memB = await memoryOf(ctx, b.id).catch(() => null);
        t.check('project B\'s memory view holds none of it', !!memB && !JSON.stringify(memB).includes(word), { block: memB?.projectBlock?.content?.slice(0, 120) ?? null, facts: memB?.facts?.length ?? null });
      }

      // 6. hq's Memory view shows the project block
      const page = ctx.a.page;
      if (page && summary) {
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/memory`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        // the shell draws after its first sync, as setup waits for it
        await page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 60_000, polling: 500 }).catch(() => {});
        const probe = summary.trim().split('\n')[0].slice(0, 40);
        const shown = await seeText(page, new RegExp(escapeRe(probe)), { timeout: 45_000 });
        const shot = await snap(page, 'project-memory-view');
        // a blank page names its cause: the workspace gone under it (another run's setup) or the view itself
        const still = shown ? null : ((await api('GET', '/v1/workspaces', { as: H(ctx) }).catch(() => ({ workspaces: [] }))).workspaces ?? []).some((w) => w.id === ws);
        const words = shown ? null : (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 300);
        t.check('hq\'s Memory view shows the project block', !!shown, { screenshot: shot, looked_for: probe, ...(shown ? {} : { workspaceStillThere: still, page: words, url: page.url() }) });
        if (fact) {
          const factShown = await seeText(page, new RegExp(escapeRe(word)), { timeout: 10_000 });
          t.note({ factInView: !!factShown });
        }
      } else {
        t.note('no browser page (SETUP=api) or no summary: API evidence only');
      }
    },
  },
];
