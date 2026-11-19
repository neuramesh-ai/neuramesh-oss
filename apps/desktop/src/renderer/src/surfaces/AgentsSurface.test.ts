// THE DESKTOP AGENTS PAGE COUNTS BY THE LADDER'S RULE (round 5: the sandbox's "serves 0 of 8"). A
// runner with no sign-in and no key publishes no runtimes, and it still serves every house-brain
// agent, because the house brain needs none (shared compute-hosts.ts, the rule hq uses too). A
// house-brain agent also wears the house name, never "Gemini · gemini-3.5-flash-lite".
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/surfaces/AgentsSurface.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { STARTER_MODEL, type MachineCapability } from '@neuramesh/shared';
import type { AgentRow, MachineRow } from '../bridge/rows-crew';
import { ComputeIntro } from '../compute/ComputeIntro';
import { AgentsSurface } from './AgentsSurface';

const fresh = new Date().toISOString();
const agent = (i: number, over: Partial<AgentRow> = {}): AgentRow => ({
  id: `a${i}`, name: `agent${i}`, role: 'developer', model: STARTER_MODEL, runtime: 'gemini', status: 'online', channels: 'general', channel_ids: 'c1', ...over,
});
// the sandbox crew (8 on the house brain), and one agent that needs a runtime the runner lacks
const crew = [...Array.from({ length: 8 }, (_, i) => agent(i)), agent(8, { name: 'coder', model: 'gpt-5.5', runtime: 'codex' })];
const runner: MachineRow = { id: 'm-runner', name: 'runner', platform: 'linux', daemon_version: '1.0.0', last_seen_at: fresh, owner_user_id: 'u1', kind: 'runner', runtimes: '[]' };
const caps: MachineCapability[] = [{ machineId: 'm-runner', ownerUserId: 'u1', lastSeenAt: fresh, runtimes: [], kind: 'runner' }];
const noop = (): void => {};
/** the markup with React's text separators taken out, so a test reads the words a person sees */
const words = (markup: string): string => markup.replace(/<!-- -->/g, '');

function agentsPage(): string {
  return words(renderToStaticMarkup(h(AgentsSurface, {
    roster: { machines: [runner], agents: crew }, activeAgents: crew, isCloud: false, meId: 'u1',
    boot: { needsOnboarding: false, machineName: 'mac', workspace: { name: 'Smoke', slug: 'smoke' } },
    members: [{ user_id: 'u1', display_name: 'Smoke' }], machineCaps: caps,
    machNameOf: (id) => (id === 'm-runner' ? 'runner' : null),
    placeOf: () => ({ machineId: 'm-runner', why: 'origin' as const }),
    refreshCreds: noop, refreshRoster: noop, setDetailAgentId: noop, setAddRemoteOpen: noop, setCreateOpen: noop,
    setMarketplaceOpen: noop, setUpgradeOpen: noop, setNav: noop, setView: noop,
  })));
}

test('a runner with no runtimes serves the 8 house-brain agents, and not the one that needs codex', () => {
  assert.match(agentsPage(), /serves <b>8 of 9<\/b> agents/);
});

test('a house-brain agent wears the house name and no runtime chip; a codex agent keeps both', () => {
  const page = agentsPage();
  assert.equal(page.match(/NeuraMesh brain \(Starter v1\)/g)?.length, 8);
  assert.ok(!page.includes('Gemini · '), 'no vendor line on a house-brain card');
  assert.equal(page.match(/rolechip rtchip/g)?.length, 1, 'only the codex agent wears a runtime chip');
  assert.ok(page.includes('Codex · gpt-5.5'));
});

test('the compute intro counts the same way', () => {
  const mac: MachineRow = { id: 'm-mac', name: 'mac', platform: 'darwin', daemon_version: '1.0.0', last_seen_at: fresh, owner_user_id: 'u1', kind: 'local', runtimes: '["claude-code"]' };
  const intro = words(renderToStaticMarkup(h(ComputeIntro, {
    workspaceName: 'Smoke', machines: [mac, runner], members: [{ user_id: 'u1', role: 'owner', display_name: 'Smoke' }],
    agents: crew, selfUserId: 'u1', selfMachineName: 'mac', askChannelId: null, onDone: noop,
  })));
  // the mac has claude-code and the runner has nothing: each serves the 8 house-brain agents, and neither serves codex
  assert.equal(intro.match(/serves 8 of 9 agents/g)?.length, 2);
});
