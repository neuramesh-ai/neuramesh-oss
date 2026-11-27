// THE UPGRADE FOOTER, as data (docs/design/whats-new-upgrades-2026-11/plan.md §3.2 and §6.1). The What's
// new card on hq and the sheet on the phone only paint what this returns: the state, the words and the
// buttons. The server runs its own checks (control-api machine-upgrade.ts) and decides. Every word here
// is ASD-STE100: active voice, simple tenses, no em dash and no semicolon.
import { compareMachineVersions, mayUpgradeMachine, workToStop, type MachineWork, type UpgradeMode, type UpgradeState } from './machine-releases';

export type UpgradeAct = 'start' | 'next_start' | 'now' | 'when_idle' | 'confirm' | 'stop_and_upgrade' | 'cancel' | 'cancel_confirm' | 'retry' | 'close' | 'later' | 'details' | 'return';

export interface UpgradeButton { act: UpgradeAct; label: string; kind: 'primary' | 'secondary' | 'danger' | 'ghost' | 'quiet' }

export interface UpgradeViewInput {
  kind: string | null | undefined;
  ownerUserId: string | null | undefined;
  selfUserId: string | null;
  /** off: no instance and none asked for. on: awake and ready. waking: a start or a drain in flight */
  power: 'off' | 'on' | 'waking';
  /** the release the machine runs (null = not known yet) */
  version: string | null;
  /** the newest published release */
  newest: { version: string; securityDeadline: string | null } | null;
  /** the last attempt: an open one, or one that ended in the last few minutes */
  upgrade: { mode: UpgradeMode; state: UpgradeState; toVersion: string; fromVersion?: string | null; step?: number | null; reason?: string | null } | null;
  /** the release the owner may return to after a success (plan §8.4), from the server. A surface that
   *  cannot send machine.upgrade_rollback leaves it out, so it shows no Return button */
  returnTo?: string | null;
  /** the fresh work report (freshWork), or null when the machine is off or the report is old */
  work: MachineWork | null;
  /** false: the workspace has no credits, so a start would fail with PLAN_LIMIT */
  credits: boolean;
  /** ops hold every upgrade (machine_release_policy.hold) */
  held: boolean;
  /** the client has no connection: an upgrade is a server command and never queues */
  offline: boolean;
  /** the person pressed Upgrade now on a busy machine and sees the confirm */
  confirming: boolean;
}

export type UpgradeViewState = 'none' | 'current' | 'off' | 'nocredit' | 'idle' | 'busy' | 'confirm' | 'armed' | 'staged' | 'run' | 'ok' | 'fail' | 'held' | 'offline';

export interface UpgradeView {
  state: UpgradeViewState;
  /** false: no footer at all (no machine, or this person may not upgrade it) */
  show: boolean;
  title: string;
  line: string;
  buttons: UpgradeButton[];
  /** the phases of an upgrade, and the one that runs now (state 'run'). A start from off has no save */
  steps: string[];
  step: number;
  /** the work that a restart stops, for the list under the words */
  work: MachineWork | null;
  security: boolean;
}

const LATER: UpgradeButton = { act: 'later', label: 'Later', kind: 'quiet' };

export function upgradeSteps(to: string, fromOff = false): string[] {
  const steps = ['Save your work', `Start on ${to}`, 'Restore your work', 'Join the relay'];
  return fromOff ? steps.slice(1) : steps;
}

/** the cost of a start, said once where a button starts the machine (plan D1) */
const START_COST = 'The machine uses credits until it sleeps again.';

/** "2 agent turns and 1 terminal", "1 terminal" */
export function workPhrase(work: MachineWork | null): string {
  const { turns, terminals } = workToStop(work);
  const parts: string[] = [];
  if (turns) parts.push(`${turns} agent ${turns === 1 ? 'turn' : 'turns'}`);
  if (terminals) parts.push(`${terminals} ${terminals === 1 ? 'terminal' : 'terminals'}`);
  return parts.join(' and ');
}

function view(state: UpgradeViewState, title: string, line: string, buttons: UpgradeButton[], extra: Partial<UpgradeView> = {}): UpgradeView {
  return { state, show: true, title, line, buttons, steps: [], step: 0, work: null, security: false, ...extra };
}

/** the footer for one machine and one person */
export function upgradeView(i: UpgradeViewInput): UpgradeView {
  const none: UpgradeView = { state: 'none', show: false, title: '', line: '', buttons: [], steps: [], step: 0, work: null, security: false };
  if (!mayUpgradeMachine(i.kind, i.ownerUserId, i.selfUserId) || !i.newest) return none;
  const to = i.newest.version;
  const cur = i.version ?? 'an older version';
  const security = Boolean(i.newest.securityDeadline);
  const later = security ? [] : [LATER];
  const u = i.upgrade;
  // a return to the last version (plan §8.4) rides the same attempt: only its words change
  const verb = u?.fromVersion && compareMachineVersions(u.toVersion, u.fromVersion) < 0 ? 'Return to' : 'Upgrade to';

  if (u?.state === 'draining' || u?.state === 'booting') {
    // a start from off never drains: the server's steps count the save, so the start's three move down one
    const fromOff = u.mode === 'start' || u.mode === 'next_start';
    const steps = upgradeSteps(u.toVersion, fromOff);
    const raw = Math.max(0, Math.min(3, u.step ?? (u.state === 'draining' ? 0 : 1)));
    const step = fromOff ? Math.max(0, raw - 1) : raw;
    return view('run', `${verb} ${u.toVersion}`, '', [{ act: 'close', label: 'Hide', kind: 'quiet' }], { steps, step, security });
  }
  if (u?.state === 'ready' && i.version === u.toVersion) {
    const back: UpgradeButton[] = i.returnTo && i.returnTo !== u.toVersion ? [{ act: 'return', label: `Return to ${i.returnTo}`, kind: 'quiet' }] : [];
    return view('ok', `Your machine runs ${u.toVersion}`, 'Your work is restored. Your agents can work again.', [{ act: 'close', label: 'Close', kind: 'secondary' }, ...back]);
  }
  if (u && (u.state === 'failed' || u.state === 'rolled_back')) {
    const line = u.reason === 'DRAIN_TIMEOUT'
      ? `Your machine is back on ${cur}. The save did not finish, so the work since its last save can be lost.`
      : `Your machine is back on ${cur}. Your work is safe. Nothing changed.`;
    return view('fail', 'The upgrade did not finish', line, [{ act: 'retry', label: 'Try again', kind: 'primary' }, { act: 'details', label: 'Details', kind: 'ghost' }]);
  }
  if (u?.state === 'armed') {
    return view('armed', `${verb} ${u.toVersion} when idle`, 'The upgrade starts when no turn runs and nobody types in a terminal for 10 minutes. Open terminals then close.',
      [{ act: 'cancel', label: 'Cancel the upgrade', kind: 'ghost' }], { work: i.work, security });
  }
  if (u?.state === 'staged') {
    // the start path stays open while the upgrade waits (George, 2026-11-24): one click starts it on the new release
    const startable = i.credits && !i.held && !i.offline;
    const start: UpgradeButton[] = startable ? [{ act: 'start', label: verb === 'Return to' ? 'Return now' : 'Upgrade now', kind: 'primary' }] : [];
    return view('staged', `${verb} ${u.toVersion} at the next start`, `Your machine stays off. It starts on ${u.toVersion} the next time it wakes.${startable ? ` ${START_COST}` : ''}`,
      [...start, { act: 'cancel', label: 'Cancel the upgrade', kind: 'ghost' }], { security });
  }
  if (i.version === to) return { ...none, state: 'current' };
  if (i.offline) return view('offline', `Your machine is on ${cur}`, 'Your connection is off. Upgrade needs a connection.', [], { security });
  if (i.held) return view('held', `Your machine is on ${cur}`, `Version ${to} is ready. Upgrades are on hold for a short time. Try again later.`, [], { security });

  const secLine = security && i.newest.securityDeadline
    ? ` Upgrade before ${new Date(i.newest.securityDeadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.`
    : '';
  if (i.power === 'off') {
    if (!i.credits) {
      return view('nocredit', `Your machine is on ${cur} and it is off`, 'Your workspace has no credits, so the machine cannot start now. The upgrade can wait for its next start.',
        [{ act: 'next_start', label: 'Upgrade at next start', kind: 'primary' }, ...later], { security });
    }
    return view('off', `Your machine is on ${cur} and it is off`, `Upgrade now starts it on ${to}. This takes about 1 minute. ${START_COST}${secLine}`,
      [{ act: 'start', label: 'Upgrade now', kind: 'primary' }, { act: 'next_start', label: 'Upgrade at next start', kind: 'ghost' }, ...later], { security });
  }
  const busy = i.work === null || i.work.turns.length > 0;
  if (i.confirming && busy) {
    const what = workPhrase(i.work);
    return view('confirm', what ? `Stop ${what}?` : 'Stop the work on your machine?', 'Each turn stops now, and each terminal closes. You can start a turn again after the upgrade.',
      [{ act: 'stop_and_upgrade', label: 'Stop and upgrade', kind: 'danger' }, { act: 'cancel_confirm', label: 'Cancel', kind: 'ghost' }], { work: i.work, security });
  }
  if (busy) {
    const line = i.work === null
      ? 'Your machine did not report its work yet. A restart can stop work that runs.'
      : 'A restart stops this work. You can wait for it to end.';
    return view('busy', 'Your machine has work in progress', `${line}${secLine}`,
      [{ act: 'when_idle', label: 'Upgrade when idle', kind: 'primary' }, { act: 'confirm', label: 'Upgrade now', kind: 'secondary' }, ...later], { work: i.work, security });
  }
  const terms = i.work?.terminals ?? 0;
  const closes = terms ? ` ${terms === 1 ? 'Your open terminal closes.' : `Your ${terms} open terminals close.`}` : '';
  return view('idle', `Your machine is on ${cur} and it is idle`, `Upgrade saves your work, then restarts the machine on ${to}. This takes about 1 minute.${closes}${secLine}`,
    [{ act: 'now', label: 'Upgrade now', kind: 'primary' }, ...(security ? [{ act: 'when_idle' as const, label: 'Upgrade when idle', kind: 'secondary' as const }] : later)], { work: i.work, security });
}
