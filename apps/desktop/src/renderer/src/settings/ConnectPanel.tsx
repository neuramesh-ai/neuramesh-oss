// ONE connect flow per connector (the composer-foot round, 2026-09-11). The room's Connections
// list and the composer foot's popover render the SAME step, so a provider's prerequisites, its
// key form and its verify-before-save live in exactly one place. Extracted from ConnectionsList,
// bodies unchanged except the copy, which now follows CLAUDE.md #11.
import { useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { type ConnectorRow } from '../bridge/rows-content';
import { errMsg } from '../lib/text';
import { flashToast } from '../lib/toast';
import { CONNECTORS, type ConnectorId, type ConnectorState } from './connectors';
import { GitHubStep } from './GitHubStep';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The image-key entry, shared by the Connections row, the composer foot AND the on-card "Connect
// an image model" prompt so all write the SAME dedicated `<provider>-image` credential — never
// the agent seat.
export function ImageKeyForm({ onSaved }: { onSaved: () => void }) {
  const [provider, setProvider] = useState<'openai' | 'gemini'>('openai');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const token = draft.trim();
    if (token.length < 8) return;
    setSaving(true);
    try {
      // its OWN provider id, never plain 'openai'/'gemini' — writing those would flip the
      // workspace seat from subscription to apikey and silently re-auth every agent
      await nm?.setCredential({ scope: 'workspace', provider: `${provider}-image`, token, authMode: 'apikey' });
      setDraft('');
      onSaved();
    } catch { /* leave the field for a retry */ }
    setSaving(false);
  };
  return (
    <>
      <p>Your designer draws post images on an API key. A subscription login cannot, because image endpoints need a key.</p>
      <span className="mkimgpick">
        <button className={`btn sm${provider === 'openai' ? ' primary' : ''}`} onClick={() => setProvider('openai')}>OpenAI</button>
        <button className={`btn sm${provider === 'gemini' ? ' primary' : ''}`} onClick={() => setProvider('gemini')}>Gemini</button>
        <a className="mkimghint" href={provider === 'openai' ? 'https://platform.openai.com/api-keys' : 'https://aistudio.google.com/apikey'} target="_blank" rel="noreferrer">get a key ↗</a>
      </span>
      <span className="mkintkey">
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }} placeholder={provider === 'openai' ? 'sk-…' : 'AIza…'} aria-label="Image generation API key" spellCheck={false} autoFocus />
        <button className="btn primary sm" disabled={saving || draft.trim().length < 8} onClick={() => void save()}>{saving ? 'Please wait…' : 'Save'}</button>
      </span>
      <p className="mkimgfoot">Kept for images only. Your agents&rsquo; sign-in stays untouched.</p>
    </>
  );
}
// module-level deep-link so a draft card in the thread can open the image-key prompt without
// threading a callback through the whole tree (mirrors _openProviderSettings)
let _openImageConnect: (() => void) | null = null;
/** The shell owns the modal; it registers the opener while mounted (an import cannot assign). */
export function setImageConnectOpener(fn: (() => void) | null) { _openImageConnect = fn; }
export function openImageConnect() { _openImageConnect?.(); }
/** the same seam for the Credits view: a video card that ran out of credits points there (the video rung) */
let _openCredits: (() => void) | null = null;
export function setCreditsOpener(fn: (() => void) | null) { _openCredits = fn; }
export function openCredits() { _openCredits?.(); }

type KeyId = 'posthog' | 'meta' | 'tiktokads';
type OauthId = 'x' | 'linkedin' | 'instagram' | 'tiktok';
const OAUTH = new Set<ConnectorId>(['x', 'linkedin', 'instagram', 'tiktok']);
/** rows key state by their display id ('tiktokads'); the mcp layer keeps the provider name ('tiktok') */
const mcpIdOf = (p: KeyId): 'posthog' | 'meta' | 'tiktok' => (p === 'tiktokads' ? 'tiktok' : p);

/** The human's deliberate off. OAuth rows revoke server-side (the sealed secret deleted — the
 *  human-only connector.disconnect); MCP rows clear the machine-local key + the room toggle.
 *  Either way the row returns to Connect, and reconnecting swaps in whichever account
 *  authorizes next (upsert keyed workspace+provider). */
export async function disconnectConnector(s: ConnectorState, channelId: string): Promise<void> {
  if (s.conn) { await nm?.connectorDisconnect(s.conn.id); return; }
  if (s.kind !== 'key') return;
  const mcpId = mcpIdOf(s.id as KeyId);
  // only meta/tiktok carry their own endpoint URL; posthog rides a documented hosted server
  if (mcpId !== 'posthog') await nm?.mcpKeySet(mcpId === 'meta' ? 'metaUrl' : 'tiktokUrl', '');
  await nm?.mcpKeySet(mcpId, '');
  await nm?.marketingIntegration(channelId, mcpId, false);
}

/** The connect step for one connector: prerequisites, then the one action. OAuth connectors hand
 *  off to the browser; key connectors verify before they save (round 12: the probe's verdict
 *  unlocks Save); the image model takes its own key form. `onDone` fires when a key lands —
 *  an OAuth hand-off finishes in the browser, and the caller's poll picks that up. */
export function ConnectPanel({ id, channelId, dead, onDone }: { id: ConnectorId; channelId: string; dead?: ConnectorRow | null; onDone: () => void }) {
  if (id === 'images') return <ImageKeyForm onSaved={onDone} />;
  if (id === 'github') return <GitHubStep channelId={channelId} dead={!!dead} onDone={onDone} />;
  if (OAUTH.has(id)) return <OauthStep id={id as OauthId} channelId={channelId} dead={dead ?? null} />;
  return <KeyStep id={id as KeyId} channelId={channelId} onDone={onDone} />;
}

function OauthStep({ id, channelId, dead }: { id: OauthId; channelId: string; dead: ConnectorRow | null }) {
  const start = () => { void nm?.connectorStart(channelId, id).catch((e) => flashToast(errMsg(e))); };
  return (
    <>
      {dead && <p>Previously connected as <b>{dead.handle}</b>. The authorization ended, so authorize again to resume.</p>}
      {id === 'x' && <><p>Authorize X in the browser. neuramesh seals the token on the server.</p><p>neuramesh publishes a post only after you approve it. Your agents also read X through this connection.</p></>}
      {id === 'linkedin' && <p>Authorize LinkedIn in the browser. neuramesh publishes to your profile only after you approve a post. The token seals on the server.</p>}
      {id === 'instagram' && <><p><b>Needs:</b> an Instagram business or creator account linked to a Facebook Page (Meta Business Suite → Linked accounts).</p><p>Authorize with Facebook. neuramesh publishes only after you approve a post, and an Instagram post requires an image.</p></>}
      {id === 'tiktok' && <p>A post lands in your TikTok inbox as a private draft. You finish and publish it in the TikTok app. A draft requires an image.</p>}
      <button className="btn primary sm" onClick={start}>Continue in the browser</button>
    </>
  );
}

function KeyStep({ id, channelId, onDone }: { id: KeyId; channelId: string; onDone: () => void }) {
  const [verify, setVerify] = useState<'idle' | 'checking' | 'ok' | `fail:${string}`>('idle');
  const [tok, setTok] = useState('');
  const [url, setUrl] = useState('');
  const label = CONNECTORS.find((c) => c.id === id)?.label ?? id;
  const mcpId = mcpIdOf(id);
  // only meta/tiktok carry their own endpoint URL; posthog rides a documented hosted server
  const hasUrl = id !== 'posthog';
  const filled = !!tok.trim() && (!hasUrl || !!url.trim());
  const runVerify = async () => {
    if (!filled) return;
    setVerify('checking');
    try {
      const r = await nm?.mcpVerify(mcpId, tok.trim(), hasUrl ? url.trim() : undefined);
      setVerify(r?.ok ? 'ok' : `fail:${r?.detail ?? 'failed'}`);
    } catch { setVerify('fail:unreachable'); }
  };
  const save = async () => {
    try {
      if (hasUrl) await nm?.mcpKeySet(mcpId === 'meta' ? 'metaUrl' : 'tiktokUrl', url.trim());
      await nm?.mcpKeySet(mcpId, tok.trim());
      await nm?.marketingIntegration(channelId, mcpId, true);
      setTok(''); setUrl(''); setVerify('idle');
      onDone();
    } catch (e) { flashToast(errMsg(e)); }
  };
  const badge = verify === 'checking' ? <span className="mkvchk">Please wait…</span>
    : verify === 'ok' ? <span className="mkintok">✓ works</span>
    : verify.startsWith('fail:') ? <span className="mkvfail">✗ {verify.slice(5)}</span> : null;
  return (
    <>
      {id === 'posthog'
        ? <p>PostHog → Settings → <b>Personal API keys</b>. Create one with read scopes and paste it here. It stays on this machine.</p>
        : <>
            <p><b>1.</b> Open {id === 'meta' ? 'Meta Ads console → AI Connectors (beta)' : 'TikTok Ads console → MCP access'} and create agent access for this ad account.</p>
            <p><b>2.</b> Paste the connector URL and access token it shows you. Both stay on this machine.</p>
          </>}
      {hasUrl && (
        <span className="mkintkey mkconnurl">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setVerify('idle'); }} placeholder="connector URL https://…" aria-label={`${label} connector URL`} />
        </span>
      )}
      <span className="mkintkey">
        <input type="password" value={tok} onChange={(e) => { setTok(e.target.value); setVerify('idle'); }} onKeyDown={(e) => { if (e.key === 'Enter') void runVerify(); }}
          placeholder={id === 'posthog' ? 'phx_…' : 'access token'} aria-label={id === 'posthog' ? 'PostHog API key' : `${label} access token`} />
        {verify === 'ok'
          ? <button className="btn primary sm" onClick={() => void save()}>Save</button>
          : <button className="btn sm" disabled={verify === 'checking' || !filled} onClick={() => void runVerify()}>Verify</button>}
      </span>
      {badge}
    </>
  );
}
