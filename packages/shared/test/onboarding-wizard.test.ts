// the wizard's pure state machine (mobile-cloud S6): order, guards, the resume rule, the pack
// recommendation, and the Launch command list the browser's onboard posts.
import { describe, expect, it } from 'vitest';
import {
  initialWizard, launchCommands, readyProviders, seedCrew, setWizardCrewName, setWizardName, setWizardProvider, setWizardSlug,
  STARTER_CREW, WIZARD_STEPS, wizardBack, wizardCanContinue, wizardNext, wizardPack, wizardStep,
} from '../src/onboarding-wizard';
import { STARTER_PACK_ID } from '../src/model-packs';

describe('onboarding wizard — order and resume', () => {
  it('walks workspace → machine → keys → team → launch and never past the end', () => {
    let s = initialWizard({ name: 'Cobalt Labs' });
    const seen = [wizardStep(s)];
    for (let i = 0; i < 6; i++) { s = wizardNext(s); seen.push(wizardStep(s)); }
    expect(seen.slice(0, 5)).toEqual([...WIZARD_STEPS]);
    expect(s.step).toBe(5);
  });
  it('a resumed wizard starts at the Machine step with its workspace, and Back never re-opens Workspace', () => {
    const s = initialWizard({ name: 'Cobalt Labs', resumeWorkspaceId: 'ws-1' });
    expect(s.step).toBe(2);
    expect(s.workspaceId).toBe('ws-1');
    expect(wizardBack(s).step).toBe(2);
    expect(wizardBack(wizardNext(s)).step).toBe(2);
    // a fresh wizard can go back to its first step
    expect(wizardBack(wizardNext(initialWizard({ name: 'x' }))).step).toBe(1);
  });
});

describe('onboarding wizard — guards', () => {
  it('Workspace needs a name and a two-letter slug; the address follows the name until edited', () => {
    let s = initialWizard({ name: 'Cobalt Labs' });
    expect(s.slug).toBe('cobalt-labs');
    expect(wizardCanContinue(s)).toBe(true);
    s = setWizardName(s, 'A');
    expect(wizardCanContinue(s)).toBe(false);
    s = setWizardSlug(s, 'Acme HQ');
    expect(s.slug).toBe('acme-hq');
    s = setWizardName(s, 'Renamed');
    expect(s.slug).toBe('acme-hq');
  });
  it('Machine and Keys never block; Team needs every seat named and seeded; Launch waits on the crew', () => {
    let s = wizardNext(initialWizard({ name: 'Cobalt Labs' }));
    expect(wizardCanContinue(s)).toBe(true);
    s = wizardNext(s);
    expect(wizardCanContinue(s)).toBe(true);
    s = wizardNext(s);
    expect(wizardCanContinue(s)).toBe(false); // no models yet
    s = seedCrew(s);
    expect(wizardCanContinue(s)).toBe(true);
    s = setWizardCrewName(s, 0, ' ');
    expect(wizardCanContinue(s)).toBe(false);
    s = wizardNext(setWizardCrewName(s, 0, 'rex'));
    expect(wizardCanContinue(s)).toBe(false);
    expect(wizardCanContinue({ ...s, launched: true })).toBe(true);
  });
});

describe('onboarding wizard — brains', () => {
  it('nothing connected recommends the starter pack; a key or an intent moves it', () => {
    const s = initialWizard({ name: 'x' });
    expect(wizardPack(s)).toBe(STARTER_PACK_ID);
    expect(readyProviders(s)).toEqual([]);
    expect(wizardPack(setWizardProvider(s, 'anthropic', { mode: 'apikey', key: 'sk-1' }))).toBe('claude-core');
    expect(wizardPack(setWizardProvider(s, 'anthropic', { mode: 'apikey', key: '' }))).toBe(STARTER_PACK_ID);
    expect(readyProviders(setWizardProvider(s, 'openai', { mode: 'subscription' }))).toEqual([{ provider: 'openai', mode: 'subscription', key: '' }]);
    // an explicit pack the ready providers cannot serve falls back to the recommendation
    expect(wizardPack({ ...s, pack: 'claude-core' })).toBe(STARTER_PACK_ID);
  });
  it('seeds every crew member with the pack\'s brain for their role', () => {
    const s = seedCrew(initialWizard({ name: 'x' }));
    expect(s.crew.every((c) => c.model.length > 0)).toBe(true);
    expect(s.crew.map((c) => c.name)).toEqual(STARTER_CREW.map((c) => c.name));
  });
});

describe('onboarding wizard — the Launch command list', () => {
  it('posts the pack, the credentials, the crew on the cloud machine, then the curator seat', () => {
    let s = seedCrew(initialWizard({ name: 'Cobalt Labs' }));
    s = setWizardProvider(s, 'anthropic', { mode: 'subscription' });
    s = setWizardProvider(s, 'gemini', { mode: 'apikey', key: ' g-key ' });
    const cmds = launchCommands(s, 'ws-1', 'runner-1');
    expect(cmds[0]).toEqual({ type: 'workspace.update', workspace: 'ws-1', activeModelPack: wizardPack(s) });
    expect(cmds[1]).toEqual({ type: 'credential.set', workspace: 'ws-1', provider: 'anthropic', scope: 'workspace', authMode: 'subscription' });
    expect(cmds[2]).toEqual({ type: 'credential.set', workspace: 'ws-1', provider: 'gemini', scope: 'workspace', authMode: 'apikey', token: 'g-key' });
    const regs = cmds.filter((c) => c.type === 'agent.register') as Array<Extract<typeof cmds[number], { type: 'agent.register' }>>;
    expect(regs.map((r) => r.name)).toEqual(['rex', 'iris', 'atlas', 'patch', 'scout', 'bosun', 'curator']);
    expect(regs.every((r) => r.machineId === 'runner-1' && r.model && r.runtime)).toBe(true);
    expect(regs[0]!.channels).toEqual(['general', 'build', 'research', 'marketing']);
    expect(regs[3]!.channels).toEqual(['general', 'build']);
    expect(regs[6]!.channels).toEqual(['build']);
    expect(regs[0]!.description).toMatch(/^Runs this room/);
    expect(regs[6]!.description).toBeUndefined();
    expect(cmds.length).toBe(3 + 7);
  });
  it('a bare workspace still launches: no credentials, the starter pack, seven registrations', () => {
    const cmds = launchCommands(seedCrew(initialWizard({ name: 'x' })), 'ws-2', 'runner-2');
    expect(cmds.filter((c) => c.type === 'credential.set')).toEqual([]);
    expect(cmds[0]).toMatchObject({ type: 'workspace.update', activeModelPack: STARTER_PACK_ID });
    expect(cmds.filter((c) => c.type === 'agent.register').length).toBe(7);
  });
});
