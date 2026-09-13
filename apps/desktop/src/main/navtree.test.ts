// The nav's session list (flat round, 2026-08-17) — the pure scoping the rail renders.
// Run from apps/desktop: pnpm exec tsx --test src/main/navtree.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chanOrder, emptyNavScope, isChatRow, isCodeRow, navFlat, navGrouped, stripChannels, NAV_FLAT_CAP, NAV_GROUP_CAP } from '../renderer/src/navtree';
import { foregroundSwapFor, navBandName, navBands } from '../renderer/src/navbands';

const CHANNELS = [
  { id: 'c-dev', project_id: 'p-site', slug: 'dev', msg_count: 12 },
  { id: 'c-general', project_id: 'p-site', slug: 'general', msg_count: 90 },
  { id: 'c-mkt', project_id: 'p-mkt', slug: 'marketing', msg_count: 40 },
  { id: 'c-lab', project_id: null, slug: 'lab', msg_count: 3 },
];
const PROJECTS = [
  { id: 'p-site', name: 'gads-site' },
  { id: 'p-mkt', name: 'marketing' },
  { id: 'p-idle', name: 'flowe-ai' },
];
const row = (key: string, channelId: string | null, when: string) => ({ key, channelId, when });
const base = { channels: CHANNELS, projects: PROJECTS, askKeys: new Set<string>(), liveKeys: new Set<string>() };

test('All projects: one recency list across the workspace, each row carrying its project', () => {
  const r = navFlat({
    ...base,
    rows: [row('a', 'c-mkt', 't050'), row('b', 'c-dev', 't040'), row('c', 'c-general', 't030')],
    scope: emptyNavScope(),
  });
  assert.deepEqual(r.rows.map((x) => x.key), ['a', 'b', 'c']); // recency, not grouped by project
  assert.deepEqual(r.rows.map((x) => x.projectName), ['marketing', 'gads-site', 'gads-site']);
  assert.equal(r.scopeProject, null);
  // the strip is the INSIDE of a project — across projects the slugs repeat, so there is none
  assert.deepEqual(r.channels, []);
});

test('EVERY project is listed in the picker, including one nobody has talked in', () => {
  const r = navFlat({ ...base, rows: [row('a', 'c-mkt', 't050')], scope: emptyNavScope() });
  assert.deepEqual(r.projects.map((p) => p.id), ['p-site', 'p-mkt', 'p-idle']);
  // the quiet project is present, clickable, and honest about being empty
  assert.equal(r.projects.find((p) => p.id === 'p-idle')!.count, 0);
  assert.equal(r.projects.find((p) => p.id === 'p-mkt')!.count, 1);
});

test('a projectless channel shelves nowhere but still draws — its row simply names no project', () => {
  const r = navFlat({ ...base, rows: [row('x', 'c-lab', 't010')], scope: emptyNavScope() });
  assert.deepEqual(r.rows.map((x) => x.key), ['x']);
  assert.equal(r.rows[0]!.projectId, null);
  assert.equal(r.rows[0]!.projectName, null);
});

test('picking a project narrows the rows AND brings back its room strip, busiest first', () => {
  const r = navFlat({
    ...base,
    rows: [row('a', 'c-mkt', 't050'), row('b', 'c-dev', 't040'), row('c', 'c-general', 't030')],
    channels: [...CHANNELS, { id: 'c-quiet', project_id: 'p-site', slug: 'quiet' }],
    scope: { projectId: 'p-site', channelId: null },
  });
  assert.deepEqual(r.rows.map((x) => x.key), ['b', 'c']);
  assert.equal(r.scopeProject!.name, 'gads-site');
  // a room with no messages still gets a chip; a missing count reads as silent, never as busy
  assert.deepEqual(r.channels.map((c) => c.slug), ['general', 'dev', 'quiet']);
  assert.deepEqual(r.channels.map((c) => c.msgs), [90, 12, 0]);
  assert.equal(r.channels.every((c) => c.on), true); // no room filter → every chip is feeding
});

test('picking a room narrows again, and the strip lights only that chip', () => {
  const r = navFlat({
    ...base,
    rows: [row('b', 'c-dev', 't040'), row('c', 'c-general', 't030')],
    scope: { projectId: 'p-site', channelId: 'c-general' },
  });
  assert.deepEqual(r.rows.map((x) => x.key), ['c']);
  assert.equal(r.scopeChannel!.slug, 'general');
  assert.deepEqual(r.channels.filter((c) => c.on).map((c) => c.slug), ['general']);
});

test('a room filter that empties the list keeps the strip — the control that undoes it stays on screen', () => {
  const r = navFlat({
    ...base,
    rows: [row('b', 'c-dev', 't040')],
    scope: { projectId: 'p-site', channelId: 'c-general' },
  });
  assert.equal(r.rows.length, 0);
  assert.equal(r.filteredOut, true);
  assert.ok(r.channels.length > 0, 'the strip survives so the filter can be cleared');
});

test('the cap keeps recency but PINS ask rows in, and moreCount tells the truth', () => {
  const many = Array.from({ length: NAV_FLAT_CAP + 4 }, (_, i) => row(`r${i}`, 'c-dev', `t${String(900 - i).padStart(3, '0')}`));
  const rows = [...many, row('ask', 'c-dev', 't010')];
  const r = navFlat({ ...base, rows, scope: emptyNavScope(), askKeys: new Set(['ask']) });
  assert.equal(r.rows.length, NAV_FLAT_CAP);
  assert.ok(r.rows.some((x) => x.key === 'ask'), 'the oldest row still shows because it holds the ask');
  assert.equal(r.rows.at(-1)!.key, 'ask'); // re-sorted to recency after the pin
  assert.equal(r.moreCount, 5);
});

test('an ask outside the scope is never silenced — the chip says so', () => {
  const rows = [row('here', 'c-dev', 't040'), row('elsewhere', 'c-mkt', 't030')];
  const inSite = navFlat({ ...base, rows, scope: { projectId: 'p-site', channelId: null }, askKeys: new Set(['elsewhere']) });
  assert.equal(inSite.askOutside, true, 'the ask lives in the project you filtered away');
  const all = navFlat({ ...base, rows, scope: emptyNavScope(), askKeys: new Set(['elsewhere']) });
  assert.equal(all.askOutside, false, 'unscoped, the ask row is right there — no dot needed');
  // and the project holding it wears its own dot in the picker either way
  assert.equal(inSite.projects.find((p) => p.id === 'p-mkt')!.hasAsk, true);
});

test('an ask the CAP hid also counts as outside — a pin can be crowded out by other pins', () => {
  const asks = Array.from({ length: NAV_FLAT_CAP + 2 }, (_, i) => row(`a${i}`, 'c-dev', `t${String(900 - i).padStart(3, '0')}`));
  const r = navFlat({ ...base, rows: asks, scope: emptyNavScope(), askKeys: new Set(asks.map((a) => a.key)) });
  assert.equal(r.rows.length, NAV_FLAT_CAP);
  assert.equal(r.askOutside, true);
});

test('a scope naming a project that no longer exists resolves to All, never to an empty rail', () => {
  const r = navFlat({ ...base, rows: [row('a', 'c-mkt', 't050')], scope: { projectId: 'p-gone', channelId: 'c-gone' } });
  assert.equal(r.scopeProject, null);
  assert.equal(r.scopeChannel, null);
  assert.deepEqual(r.rows.map((x) => x.key), ['a']);
});

test('a room filter naming a room outside the picked project is dropped, not obeyed', () => {
  const r = navFlat({
    ...base,
    rows: [row('b', 'c-dev', 't040'), row('c', 'c-general', 't030')],
    scope: { projectId: 'p-site', channelId: 'c-mkt' }, // #marketing belongs to p-mkt
  });
  assert.equal(r.scopeChannel, null);
  assert.deepEqual(r.rows.map((x) => x.key), ['b', 'c']); // the project's rows, unfiltered
});

test('live rides the picker rows so a working project reads while its rail is elsewhere', () => {
  const r = navFlat({
    ...base,
    rows: [row('a', 'c-mkt', 't050'), row('b', 'c-dev', 't040')],
    scope: { projectId: 'p-site', channelId: null },
    liveKeys: new Set(['a']),
  });
  assert.equal(r.projects.find((p) => p.id === 'p-mkt')!.live, true);
  assert.equal(r.projects.find((p) => p.id === 'p-site')!.live, false);
});

// ── the channel strip's one-row cap (2026-08-09) ─────────────────────────────────────────
test('stripChannels: ≤cap shows all with no more-chip; >cap folds the tail into a count', () => {
  const ch = (slug: string, on = true, hasAsk = false, msgs = 0) => ({ id: `c-${slug}`, slug, on, hasAsk, msgs });
  assert.deepEqual(stripChannels([ch('build'), ch('general')]), { visible: [ch('build'), ch('general')], more: 0 });
  const four = [ch('build'), ch('general'), ch('marketing'), ch('research')];
  const r = stripChannels(four);
  assert.deepEqual(r.visible.map((c) => c.slug), ['build', 'general']); // all silent → slug breaks the tie
  assert.equal(r.more, 2);
});

// ── busiest room first (2026-08-11, George) ─────────────────────────────────────────
test('chanOrder: the busiest room leads, and a busy late-slug room beats a quiet early one', () => {
  const ch = (slug: string, msgs: number) => ({ id: `c-${slug}`, slug, on: true, hasAsk: false, msgs });
  const rooms = [ch('build', 4), ch('archive', 0), ch('research', 120), ch('general', 31)];
  assert.deepEqual([...rooms].sort(chanOrder).map((c) => c.slug), ['research', 'general', 'build', 'archive']);
  // and the cap now keeps the rooms you LIVE in, which is the whole reason this order exists:
  // under slug order this strip would have shown #archive and #build and folded #research away.
  assert.deepEqual(stripChannels(rooms).visible.map((c) => c.slug), ['research', 'general']);
});

test('chanOrder: equal traffic falls back to slug, so silent rooms never shuffle between loads', () => {
  const ch = (slug: string, msgs: number) => ({ id: `c-${slug}`, slug, on: true, hasAsk: false, msgs });
  const rooms = [ch('zulu', 0), ch('alpha', 0), ch('mike', 0)];
  assert.deepEqual([...rooms].sort(chanOrder).map((c) => c.slug), ['alpha', 'mike', 'zulu']);
});

test('stripChannels: the filtered-to room and ask-holding rooms PIN into the cap', () => {
  const ch = (slug: string, on: boolean, hasAsk = false, msgs = 0) => ({ id: `c-${slug}`, slug, on, hasAsk, msgs });
  // narrowed to #research (filter active): the lit chip must be visible or the filter is invisible
  const filtered = stripChannels([ch('build', false), ch('general', false), ch('marketing', false), ch('research', true)]);
  assert.ok(filtered.visible.some((c) => c.slug === 'research'), 'the lit chip is in the row');
  assert.equal(filtered.more, 2);
  // an ask pins in even unfiltered — a hidden ask dot is a silenced ask (navtree rule ⑥)
  const asked = stripChannels([ch('alpha', true), ch('beta', true), ch('zulu', true, true)]);
  assert.ok(asked.visible.some((c) => c.slug === 'zulu'), 'the ask chip is in the row');
  assert.equal(asked.more, 1);
  // pins re-sort to the resting order — pinning never reorders what the eye scans
  assert.deepEqual(asked.visible, [...asked.visible].sort(chanOrder));
});

test('code mode: the filter runs before the cap, the picker counts and askOutside (rail-ink round)', () => {
  const when = (i: number) => `2026-09-04T00:${String(i).padStart(2, '0')}:00.000Z`;
  const rows = Array.from({ length: NAV_FLAT_CAP + 6 }, (_, i) => ({
    key: `r${i}`, channelId: i % 2 ? 'c-dev' : 'c-mkt', when: when(i),
    branch: i % 6 === 0 ? `nm/${1000 + i}-x` : null,
    task: i % 6 === 3 ? { branch: null, pr_url: `https://github.com/x/y/pull/${i}` } : null,
  }));
  const code = rows.filter(isCodeRow);
  assert.equal(code.length, 6, 'three branches + three PRs');
  const r = navFlat({ rows, channels: CHANNELS, projects: [{ id: 'p-site', name: 'Site' }, { id: 'p-mkt', name: 'Mkt' }], scope: emptyNavScope(), askKeys: new Set(['r1']), liveKeys: new Set(), filter: isCodeRow });
  assert.deepEqual(r.rows.map((x) => x.key).sort(), code.map((x) => x.key).sort(), 'only code rows, and no cap bites at six');
  assert.equal(r.moreCount, 0);
  assert.equal(r.projects.find((p) => p.id === 'p-site')!.count + r.projects.find((p) => p.id === 'p-mkt')!.count, 6, 'the picker counts what the mode shows');
  assert.equal(r.askOutside, false, 'an ask on a row the mode does not list is not "hidden by the scope" — it is in the other mode');
  // the predicate is written for the engineering session that does not exist on main yet
  assert.equal(isCodeRow({ engineeringSessionId: 'es-1' }), true);
  assert.equal(isCodeRow({ task: { branch: null, pr_url: null } }), false);
  // Chat keeps every conversation, repo-backed tasks included, and never an engineering session
  assert.equal(isChatRow({ engineeringSessionId: 'es-1' }), false);
  assert.equal(isChatRow({ engineeringSessionId: null }), true);
  assert.equal(isChatRow({}), true);
});

test('grouped rail: one folder per project that holds a session, newest folder first, orphans flat (rail-ink round)', () => {
  const when = (i: number) => `2026-09-04T00:${String(i).padStart(2, '0')}:00.000Z`;
  const rows = [
    { key: 'a', channelId: 'c-dev', when: when(9) },     // p-site
    { key: 'b', channelId: 'c-mkt', when: when(12) },    // p-mkt — the newest session of all
    { key: 'c', channelId: 'c-general', when: when(3) }, // p-site
    { key: 'd', channelId: 'c-lab', when: when(7) },     // no project → orphan
    { key: 'e', channelId: 'c-dev', when: when(1) },     // p-site
  ];
  const projects = [{ id: 'p-site', name: 'Site' }, { id: 'p-mkt', name: 'Mkt' }, { id: 'p-quiet', name: 'Quiet' }];
  const g = navGrouped({ rows, channels: CHANNELS, projects, askKeys: new Set(['e']), liveKeys: new Set(['a']), folded: new Set(), expanded: new Set() });
  assert.deepEqual(g.groups.map((x) => x.id), ['p-mkt', 'p-site'], 'newest folder first; an empty project is not a folder');
  const site = g.groups[1]!;
  assert.deepEqual(site.rows.map((r) => r.key), ['a', 'c', 'e'], 'recency inside the folder');
  assert.equal(site.count, 3); assert.equal(site.hidden, 0); assert.equal(site.hasAsk, true); assert.equal(site.live, true);
  assert.equal(site.rows[0]!.projectName, 'Site', 'rows are decorated like the flat list');
  assert.deepEqual(g.orphans.map((r) => r.key), ['d']);
  assert.equal(g.askFolded, false);
});

test('grouped rail: the folder cap pins asks, "Show more" lifts it, a folded folder keeps its count and its ask', () => {
  const when = (i: number) => `2026-09-04T00:${String(i).padStart(2, '0')}:00.000Z`;
  const rows = Array.from({ length: NAV_GROUP_CAP + 4 }, (_, i) => ({ key: `r${i}`, channelId: 'c-dev', when: when(i) }));
  const projects = [{ id: 'p-site', name: 'Site' }];
  const base = { rows, channels: CHANNELS, projects, askKeys: new Set(['r0']), liveKeys: new Set<string>() };
  const capped = navGrouped({ ...base, folded: new Set(), expanded: new Set() }).groups[0]!;
  assert.equal(capped.rows.length, NAV_GROUP_CAP);
  assert.ok(capped.rows.some((r) => r.key === 'r0'), 'the oldest row is an ask, so it pins into the cap');
  assert.equal(capped.hidden, 4);
  const lifted = navGrouped({ ...base, folded: new Set(), expanded: new Set(['p-site']) }).groups[0]!;
  assert.equal(lifted.rows.length, NAV_GROUP_CAP + 4); assert.equal(lifted.hidden, 0);
  const folded = navGrouped({ ...base, folded: new Set(['p-site']), expanded: new Set() });
  assert.equal(folded.groups[0]!.rows.length, 0); assert.equal(folded.groups[0]!.count, NAV_GROUP_CAP + 4);
  assert.equal(folded.groups[0]!.hasAsk, true); assert.equal(folded.askFolded, true, 'folding never silences an ask');
});

// ── the connection bands (U3b, the source-release round: artboards B0 to B2) ──
const CONNS = [
  { id: 'local', kind: 'local' as const, workspaceId: 'w-local' },
  { id: 'cloud', kind: 'cloud' as const, workspaceId: 'w-cloud' },
];
const tagged = (key: string, connectionId: string, when: string) => ({ key, channelId: null, when, connectionId });

test('navBands: ONE connection draws no band — the rows come back untouched (B0 is today\'s rail)', () => {
  const rows = [tagged('a', 'local', 't2'), tagged('b', 'local', 't1')];
  const r = navBands({ rows, connections: [CONNS[0]!], foregroundId: 'local', askKeys: new Set(), liveKeys: new Set(), folded: new Set() });
  assert.equal(r, null);
});

test('navBands: two connections → LOCAL then CLOUD, each with its own count, the foreground band lit', () => {
  const rows = [tagged('c1', 'cloud', 't9'), tagged('l1', 'local', 't8'), tagged('l2', 'local', 't7'), tagged('c2', 'cloud', 't6')];
  const r = navBands({ rows, connections: [CONNS[1]!, CONNS[0]!], foregroundId: 'cloud', askKeys: new Set(), liveKeys: new Set(), folded: new Set() })!;
  assert.deepEqual(r.map((b) => b.name), ['Local', 'Cloud'], 'local leads whatever order the registry hands over');
  assert.deepEqual(r.map((b) => b.count), [2, 2]);
  assert.deepEqual(r.map((b) => b.on), [false, true]);
  assert.deepEqual(r[1]!.rows.map((x) => x.key), ['c1', 'c2']);
});

test('navBands: a row with no tag rides the FOREGROUND band (an engineering session lives on this Mac)', () => {
  const rows = [{ key: 'eng', channelId: null, when: 't5' }, tagged('c1', 'cloud', 't4')];
  const r = navBands({ rows, connections: CONNS, foregroundId: 'local', askKeys: new Set(), liveKeys: new Set(), folded: new Set() })!;
  assert.deepEqual(r[0]!.rows.map((x) => x.key), ['eng']);
  assert.equal(r[0]!.count, 1);
});

test('navBands: a folded band keeps its count, its ask and its live pulse — a fold never silences an ask', () => {
  const rows = [tagged('c1', 'cloud', 't9'), tagged('c2', 'cloud', 't8'), tagged('l1', 'local', 't7')];
  const r = navBands({ rows, connections: CONNS, foregroundId: 'local', askKeys: new Set(['c2']), liveKeys: new Set(['c1']), folded: new Set(['cloud']) })!;
  const cloud = r[1]!;
  assert.equal(cloud.folded, true);
  assert.deepEqual(cloud.rows, [], 'a folded band shows no rows');
  assert.equal(cloud.count, 2);
  assert.equal(cloud.hasAsk, true);
  assert.equal(cloud.live, true);
  assert.equal(r[0]!.hasAsk, false);
});

test('navBands: a custom connection is a band named by its host', () => {
  const conns = [CONNS[0]!, { id: 'custom:x', kind: 'custom' as const, host: 'nm.acme.internal', workspaceId: 'w-x' }];
  const r = navBands({ rows: [tagged('x1', 'custom:x', 't1')], connections: conns, foregroundId: 'local', askKeys: new Set(), liveKeys: new Set(), folded: new Set() })!;
  assert.deepEqual(r.map((b) => b.name), ['Local', 'nm.acme.internal']);
  assert.equal(navBandName({ kind: 'custom', host: null }), 'Server', 'no host still reads as a word, never blank');
});

test('foregroundSwapFor: a row on the other connection asks for { connectionId, workspaceId }; a foreground row asks for nothing', () => {
  assert.deepEqual(foregroundSwapFor(tagged('c1', 'cloud', 't1'), 'local', CONNS), { connectionId: 'cloud', workspaceId: 'w-cloud' });
  assert.equal(foregroundSwapFor(tagged('l1', 'local', 't1'), 'local', CONNS), null);
  assert.equal(foregroundSwapFor({ key: 'eng', channelId: null, when: 't1' }, 'local', CONNS), null, 'an untagged row is the foreground\'s');
  assert.equal(foregroundSwapFor(tagged('z', 'gone', 't1'), 'local', CONNS), null, 'a tag the registry no longer knows swaps nothing');
});
