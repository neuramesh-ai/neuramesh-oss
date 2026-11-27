// The area setup verbs (docs/design/sales-onboarding-2026-11/plan.md SO1 to SO16): the person's own moves in a setup
// run. Each is HUMAN_ONLY (and in MACHINE_REFUSED), and each checks the person's access to the flow's area, the
// destination's own check, so a Local connection never serves it. The run's server half is sales-setup-run.ts.
import { AREA_SETUP_FLOWS, type Actor } from '@neuramesh/shared';
import type { Command } from '../commands';
import { DomainError } from '../errors';
import type { CommandOutcome } from '../handler';
import { advanceSalesSetup, answerSalesStep, endSalesSetup, hideSalesSetup, skipSalesStep, startSalesSetup } from '../sales-setup-run';
import type { Store } from '../store';
import { assertSalesAccess } from './sales';

type AreaCommand = Extract<Command, { type: 'setup.start' | 'setup.answer' | 'setup.skip' | 'setup.end' | 'setup.hide' | 'setup.check' }>;
const AREA = new Set(['setup.start', 'setup.answer', 'setup.skip', 'setup.end', 'setup.hide', 'setup.check']);
const isArea = (c: Command): c is AreaCommand => AREA.has(c.type);

export async function setupAreaCommands(store: Store, actor: Actor, cmd: Command): Promise<CommandOutcome | undefined> {
  if (!isArea(cmd)) return undefined;
  if (actor.kind !== 'human') throw new DomainError('HUMAN_ONLY', 'a person walks setup');
  const flow = AREA_SETUP_FLOWS[cmd.flow];
  if (!flow) throw new DomainError('NOT_FOUND', `unknown setup flow ${cmd.flow}`);
  await assertSalesAccess(store, actor, cmd.workspace);
  const ws = cmd.workspace;
  switch (cmd.type) {
    case 'setup.start': {
      const { run, created } = await startSalesSetup(store, actor, ws);
      return { ok: true, run: run?.id ?? null, thread: run?.thread_id ?? null, created } as never;
    }
    case 'setup.answer': return { ok: true, now: (await answerSalesStep(store, ws, { step: cmd.step, website: cmd.website, offer: cmd.offer, customer: cmd.customer }))?.now ?? null } as never;
    case 'setup.skip': return { ok: true, now: (await skipSalesStep(store, ws, cmd.step))?.now ?? null } as never;
    case 'setup.end': await endSalesSetup(store, ws); return { ok: true } as never;
    case 'setup.hide': await hideSalesSetup(store, ws); return { ok: true } as never;
    case 'setup.check': return { ok: true, now: (await advanceSalesSetup(store, ws))?.now ?? null } as never;
  }
}
