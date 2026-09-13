// WHERE IT RUNS (0119) — live truth first, then the routing answer for the viewer. They
// disagree often (an agent working on a teammate's machine while your own serves you), and
// collapsing them into one row is how "which machine is this on?" stayed unanswerable.
// Split out of views/AgentDetails.tsx.
export function AgentPlace({ place }: { place?: { on?: string | null; mine?: string | null; why?: string | null } | null }) {
  return (
    <>
  <div className="kvline"><span>runs on</span>{place?.on
    ? <b><span className="kvm">{place.on}</span></b>
    : <b style={{ color: 'var(--dim)', fontWeight: 400 }}>idle</b>}</div>
  <div className="kvline"><span>your requests</span>{place?.mine
    ? <b><span className="kvm">{place.mine}</span></b>
    : <b style={{ color: 'var(--warn)', fontWeight: 400 }}>no machine you can use</b>}</div>
  {place?.why && <div className="kvline"><span /><b style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 11 }}>{place.why}</b></div>}
    </>
  );
}
