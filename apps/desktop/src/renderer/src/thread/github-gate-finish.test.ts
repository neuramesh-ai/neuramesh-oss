// the gate's finish, run for real (PR #694, the second review round). The person grants from the blocked gate, and
// its 5 s poll asks. The resolve's resume answers the hidden card's row, and that row can sync back before the resolve
// answers: the sign moves and the gate asks a second time. Both answers said connected, and the late one ran the old
// reopen, which closed the channel of the new turn and sent the root prompt again. The real GitHubGate and
// useGitHubGrant run here on a one-instance hook runtime, with a fake bridge whose answers the test holds.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import * as React from 'react';

const asks: Array<(answer: unknown) => void> = [];
// the bridge is read once, when the module loads: it is in place before the gate's first import
(globalThis as { window?: unknown }).window = { nm: {
  githubResolve: () => new Promise((answer) => { asks.push(answer); }),
  connectorStart: async () => ({ ok: true }),
} };
const internals = (React as unknown as Record<string, { H: unknown }>).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE!;
const flush = () => new Promise((done) => setImmediate(done));
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: unknown };
/** one mounted component on React's own hook dispatcher: no DOM, and the test renders it again by hand */
function mount<P>(component: (props: P) => unknown, props: P, signs: unknown) {
  const slots: Slot[] = [];
  let at = 0, live = true, sign = '', effects: Array<() => void> = [];
  const slot = () => (slots[at++] ??= {});
  const dispatcher = {
    useState: (init: unknown) => {
      const s = slot(); if (!('value' in s)) s.value = typeof init === 'function' ? (init as () => unknown)() : init;
      return [s.value, (u: unknown) => { if (live) s.value = typeof u === 'function' ? (u as (v: unknown) => unknown)(s.value) : u; }];
    },
    useRef: (init: unknown) => { const s = slot(); if (!('value' in s)) s.value = { current: init }; return s.value; },
    useCallback: (fn: unknown, deps: unknown[]) => { const s = slot(); if (!same(s.deps, deps)) { s.value = fn; s.deps = deps; } return s.value; },
    useEffect: (fn: () => unknown, deps: unknown[]) => {
      const s = slot(); if (same(s.deps, deps)) return; s.deps = deps;
      effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = fn(); });
    },
    useContext: (ctx: { _currentValue: unknown }) => (ctx === signs ? sign : ctx._currentValue),
  };
  const render = (next = sign) => {
    const held = internals.H; internals.H = dispatcher; at = 0; sign = next; effects = [];
    try { return component(props) as { props: { g: { grant: () => Promise<void> } } }; } finally { internals.H = held; for (const run of effects) run(); }
  };
  const unmount = () => { live = false; for (const s of slots) if (typeof s?.cleanup === 'function') s.cleanup(); };
  return { render, unmount };
}

/** the blocked gate after the person pressed Connect GitHub: the poll's ask is in flight */
async function polling(t: TestContext) {
  t.mock.timers.enable({ apis: ['setInterval'] });
  asks.length = 0;
  const { GitHubGate, GitHubSigns } = await import('./GitHubGate');
  const run = { opened: 0 };
  const gate = mount(GitHubGate, { channelId: 'c-1', room: 'dev', repoName: 'acme/app', folder: false, onConnected: () => { run.opened += 1; } }, GitHubSigns);
  gate.render('');
  asks.shift()!({ ok: false, code: 'NOT_INSTALLED', error: 'The app is not installed.', repos: [] }); await flush();
  await gate.render().props.g.grant();
  gate.render();
  t.mock.timers.tick(5000);
  assert.equal(asks.length, 1);
  return { gate, run };
}
const connected = async () => { asks.shift()!({ ok: true, handle: 'acme/app' }); await flush(); };

test('two connected answers reach one gate: the session opens once', async (t) => {
  const { gate, run } = await polling(t);
  gate.render('m-1');
  assert.equal(asks.length, 2);
  await connected();
  assert.equal(run.opened, 1);
  gate.unmount();
  await connected();
  assert.equal(run.opened, 1);
});

test('an answer that lands after the gate left opens nothing: a send or a room change took the gate away', async (t) => {
  const { gate, run } = await polling(t);
  gate.unmount();
  await connected();
  assert.equal(run.opened, 0);
});
