// The wizard's final step — the fan-out reveal. Split out of views/Onboarding.tsx (its
// 250-line cap), matching OnboardingPacks / OnboardingCrew / OnboardingMachine.
//
// The stats line reads differently per client: the desktop counts the Mac that just
// registered, the browser counts the workspace's CLOUD machine (cloud-first round 4) —
// which is the machine every agent here will actually run on.
import { AgentAvatar } from '../components/AgentAvatar';
import { DEFAULT_CHANNELS } from '../lib/defaults';
import { IS_WEB } from '../lib/platform';

export function OnboardingLaunch({ name, crew, ready, err }: {
  name: string;
  crew: Array<{ role: string; name: string; emoji: string }>;
  ready: boolean;
  err: string;
}) {
  return (
    <>
      <h1 className="obtitle"><span style={{ color: 'var(--accent)' }}>{name.trim() || 'Your workspace'}</span> {ready ? 'is live.' : 'comes online…'}</h1>
      <div className={`obassemcrew${ready ? '' : ' assembling'}`}>
        {crew.map((c) => (
          <div key={c.role} className="obassemmember">
            <span className="obassemav"><AgentAvatar name={c.name} emoji={c.emoji} size={48} radius={14} />{ready && <i className="obassemdot" />}</span>
            <span className="obassemname">{c.name}</span>
            <span className="obassemrole">{c.role}</span>
          </div>
        ))}
      </div>
      <div className="obassemstats">
        <span><b>{crew.length}</b> agents</span>
        <span><b>1</b> {IS_WEB ? 'cloud machine' : 'machine'} online</span>
        <span><b>{DEFAULT_CHANNELS.length}</b> channels</span>
      </div>
      {!ready && <p className="obassemcopy">Your workspace and your agents start{IS_WEB ? ' on your cloud machine' : ' on this machine'}. Please wait…</p>}
      {err && <div className="loginerr" style={{ textAlign: 'center', marginTop: 8 }}>{err}</div>}
    </>
  );
}
