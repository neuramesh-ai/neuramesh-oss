// The wizard's machine step — split out of views/Onboarding.tsx (the file's 250-line cap).
//
// The step means two different things per client, which is why the two orders differ
// (cloud-first round 4, approved 2026-08-28). On DESKTOP it comes FIRST: this Mac becomes
// home base, and Continue blocks until the daemon connects, because the Keys step then
// probes that machine for CLI logins. In the BROWSER it comes SECOND, right after the
// workspace is minted — a cloud machine is provisioned against a workspace id, so the id
// must exist before there is a machine to show. It never blocks: provisioning began at the
// previous step and the Launch step absorbs whatever is left.
import { IconMachine } from '../ui/icons';
import { IS_WEB } from '../lib/platform';

export function OnboardingMachine({ machineName, connected, workspaceName, provisioned }: {
  machineName: string;
  connected: boolean;
  /** browser only: the workspace just created, which the machine belongs to */
  workspaceName?: string;
  /** browser only: the workspace exists, so the fleet has something to provision against */
  provisioned?: boolean;
}) {
  if (IS_WEB) {
    const ws = workspaceName?.trim();
    return (
      <>
        <h1 className="obtitle">Your machine is starting</h1>
        <p className="obsub">
          {ws ? <><b>{ws}</b> has its cloud machine.</> : 'Your workspace has its cloud machine.'} Free to start.
          Your agents run there, even when this tab is closed. A Mac can join later as home base.
        </p>
        <div className="obmachine">
          <span className="obmachineico"><IconMachine s={19} /></span>
          <div className="obmachinebody">
            <b>{ws ? `${ws} · workspace machine` : 'workspace machine'}</b>
            {/* the dial's vocabulary (round 4): provisioning → waking → awake → idle. the row
                is honest about which of those it can actually claim — until the fleet reports
                back, "provisioning" is the truthful state, never "awake". */}
            <span>{provisioned ? 'provisioning · private namespace · us-east4' : 'arrives with your workspace'}</span>
          </div>
          <span className={provisioned ? 'obmachinedot live' : 'obmachinedot'} />
        </div>
        <div className="obhint">outbound-only · gVisor-sandboxed · your code and keys never leave it</div>
      </>
    );
  }
  return (
    <>
      <h1 className="obtitle">Connect your machine</h1>
      <p className="obsub">Your agents run on this Mac. It connects outbound only, with no open ports.</p>
      <div className={`obmachine${connected ? ' on' : ''}`}>
        <span className="obmachineico"><IconMachine s={19} /></span>
        <div className="obmachinebody">
          <b>{machineName}</b>
          <span>{connected ? 'online · daemon connected · home base' : 'connecting this machine…'}</span>
        </div>
        <span className={connected ? 'obmachinedot on' : 'obmachinedot live'} />
      </div>
    </>
  );
}
