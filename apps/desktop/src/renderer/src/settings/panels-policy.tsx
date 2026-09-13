// The policy gate — what a machine will run without asking, and what it must ask about.
// Split out of settings/panels-compute.tsx.
import { DEFAULT_PROTECTED, POLICY_GROUPS, V_COLOR, isProtectedPathRule, pathOfGlob, sameSelector, selectorLabel } from './policy';
import { Switch } from '../ui/Switch';
import { defaultBaselineRules, mergePolicies, type PolicyRule, type PolicyVerdict } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { type PolicyRowUI } from '../bridge/rows-infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Workspace failover policy — what happens when a preferred subscription login is down.
// Manual (default) surfaces a reconnect card (no surprise spend); Auto falls over to a provided
// API key. Mirrors the project-automation Switch pattern.
export function FailoverPolicy() {
  const [auto, setAuto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void nm?.workspaceSettings().then((s) => setAuto(!!s.autoFailover)).catch(() => setAuto(false)); }, []);
  const toggle = async () => {
    if (!nm || busy || auto === null) return;
    const next = !auto;
    setBusy(true); setAuto(next);
    try { await nm.workspaceUpdate({ autoFailover: next }); } catch { setAuto(!next); } finally { setBusy(false); }
  };
  return (
    <div className="failover">
      <div className="failoverrow">
        <div className="failovertxt">
          <b>Auto fail over to an API key</b>
          <span>{auto
            ? 'On — when a subscription login is down, agents use your API key (and its metered cost) instead of stopping.'
            : 'Off — agents ask you to reconnect or switch to a key first. No unintended spend (recommended).'}</span>
        </div>
        <Switch on={!!auto} onToggle={() => void toggle()} title={auto === null ? '…' : auto ? 'Auto' : 'Manual'} />
      </div>
    </div>
  );
}

// A small on/off switch for the machine-level sandbox toggle (disabled + dimmed when env-pinned).
export function SandboxToggle({ enabled, disabled, onChange }: { enabled: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={enabled} aria-label="Filesystem sandbox" disabled={disabled} onClick={() => onChange(!enabled)}
      style={{ width: 40, height: 23, borderRadius: 12, border: '1px solid var(--border2)', background: enabled ? 'var(--green)' : 'var(--panel3)', position: 'relative', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1, transition: 'background .15s var(--ease)', flexShrink: 0, padding: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: enabled ? 19 : 2, width: 17, height: 17, borderRadius: 9, background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.25)', transition: 'left .15s var(--ease)' }} />
    </button>
  );
}

// The workspace agent-policy panel: a machine-level sandbox toggle, the protected-paths list (the
// fs.read deny rules the sandbox + tool-gate enforce), and the allow/ask/deny rules by capability.
export function PolicyPanel() {
  const [rows, setRows] = useState<PolicyRowUI[]>([]);
  const [sbx, setSbx] = useState<{ enabled: boolean; envForced: boolean } | null>(null);
  const [newPath, setNewPath] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => { void nm?.policies().then((r) => setRows(r as PolicyRowUI[])).catch(() => setRows([])); }, []);
  useEffect(() => { load(); void nm?.sandboxGet().then(setSbx).catch(() => {}); }, [load]);
  const overrides = useMemo<PolicyRule[]>(() => rows.flatMap((r) => {
    try {
      return [{ id: r.id, scope: r.scope as PolicyRule['scope'], capability: r.capability as PolicyRule['capability'], selector: JSON.parse(r.selector) as PolicyRule['selector'], verdict: r.verdict as PolicyVerdict, rationale: r.rationale ?? undefined, locked: !!r.locked }];
    } catch {
      return [];
    }
  }), [rows]);
  const effective = useMemo(() => mergePolicies(defaultBaselineRules(), overrides), [overrides]);
  const persistedId = (r: PolicyRule): string | undefined => overrides.find((o) => o.capability === r.capability && sameSelector(o.selector, r.selector))?.id;
  const setVerdict = (r: PolicyRule, verdict: PolicyVerdict) => { void nm?.policySet({ id: persistedId(r), scope: 'workspace', capability: r.capability, selector: r.selector, verdict, rationale: r.rationale, locked: r.locked }).then(load).catch(() => {}); };
  const on = !!sbx?.enabled;
  const toggleSandbox = (enabled: boolean) => { if (!sbx || sbx.envForced) return; setSbx({ ...sbx, enabled }); void nm?.sandboxSet(enabled).catch(() => setSbx((s) => (s ? { ...s, enabled: !enabled } : s))); };
  // human-added protected paths = fs.read deny path rules beyond the locked defaults
  const custom = effective.filter((r) => isProtectedPathRule(r) && !r.locked && !DEFAULT_PROTECTED.includes(pathOfGlob(r.selector.kind === 'path' ? r.selector.glob : '')));
  const addProtected = () => { const p = newPath.trim().replace(/^[~/]+/, '').replace(/\/+$/, ''); if (!p) return; void nm?.policySet({ scope: 'workspace', capability: 'fs.read', selector: { kind: 'path', glob: `**/${p}/**` }, verdict: 'deny', rationale: `Agents can’t read ${p}` }).then(() => { setNewPath(''); setAdding(false); load(); }).catch(() => {}); };

  return (
    <div>
      <p className="modalhint" style={{ marginBottom: 13 }}>What agents may do here — <b>ask</b> pauses for your approval, <b>deny</b> blocks it. The sandbox makes a deny binding at the OS kernel.</p>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '11px 12px', borderRadius: 10, background: 'var(--panel2)', border: '1px solid var(--border)', marginBottom: 16 }}>
        <span style={{ fontSize: 15, lineHeight: 1.3 }} aria-hidden>🔒</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Filesystem sandbox <span style={{ fontSize: 10, fontWeight: 500, color: on ? 'var(--green)' : 'var(--dim)' }}>· {on ? 'kernel-enforced' : 'off'}</span></div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', lineHeight: 1.55 }}>
            Jails agents at the OS kernel — no reading the protected paths or other projects, even from a shell command.
            {sbx?.envForced ? <span style={{ display: 'block', marginTop: 3, color: 'var(--dim)' }}>Pinned by <span style={{ fontFamily: 'var(--mono)' }}>NM_SANDBOX_FS</span> on this machine.</span> : null}
          </div>
        </div>
        <SandboxToggle enabled={on} disabled={!sbx || sbx.envForced} onChange={toggleSandbox} />
      </div>

      <div style={{ marginBottom: 18 }}>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 5 }}>Protected paths</div>
        <p className="fldhint" style={{ margin: '0 0 9px' }}>Never readable by agents. Credential stores are locked; add your own below.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 9 }}>
          {DEFAULT_PROTECTED.map((p) => (
            <span key={p} style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--panel3)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--muted)' }}>🔒 {p}</span>
          ))}
          {custom.map((r) => {
            const pid = persistedId(r);
            const p = pathOfGlob(r.selector.kind === 'path' ? r.selector.glob : '');
            return (
              <span key={r.id} style={{ fontFamily: 'var(--mono)', fontSize: 11, background: 'var(--panel3)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                {p}
                {pid ? <button type="button" onClick={() => { void nm?.policyDelete(pid).then(load).catch(() => {}); }} style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0, lineHeight: 1 }} aria-label={`remove ${p}`}>×</button> : null}
              </span>
            );
          })}
        </div>
        {adding ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <input autoFocus value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder=".config/gcloud" onKeyDown={(e) => { if (e.key === 'Enter') addProtected(); else if (e.key === 'Escape') { setAdding(false); setNewPath(''); } }} style={{ flex: 1 }} />
            <button className="btn" type="button" onClick={addProtected}>Add</button>
          </div>
        ) : (
          <button className="btn sm" type="button" onClick={() => setAdding(true)}>+ Add path</button>
        )}
      </div>

      {POLICY_GROUPS.map((g) => {
        const grp = effective.filter((r) => g.caps.includes(r.capability) && !isProtectedPathRule(r));
        if (!grp.length) return null;
        return (
          <div key={g.title} style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--dim)', marginBottom: 4 }}>{g.title}</div>
            {grp.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 2px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5 }}>{r.capability} · <span style={{ fontFamily: 'var(--mono)' }}>{selectorLabel(r.selector)}</span></div>
                  {r.rationale ? <div style={{ fontSize: 10.5, color: 'var(--dim)' }}>{r.rationale}</div> : null}
                </div>
                {r.locked ? (
                  <span style={{ fontSize: 10.5, color: 'var(--dim)', whiteSpace: 'nowrap' }}>🔒 {r.verdict}</span>
                ) : (
                  <div className="threadseg" role="group" aria-label="verdict">
                    {(['allow', 'ask', 'deny'] as const).map((v) => (
                      <button key={v} type="button" className={r.verdict === v ? 'on' : ''} style={r.verdict === v ? { color: V_COLOR[v], fontWeight: 600 } : undefined} onClick={() => setVerdict(r, v)}>{v}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
      <p className="fldhint" style={{ marginTop: 2 }}>Egress is allowed by default; the sandbox proxy enforces the host allowlist. Set <b>Network → ask</b> to review each host, or <b>deny</b> to cut the network.</p>
    </div>
  );
}
