// Rooms and repos — creating a channel, its settings, and attaching a repo.
// Extracted from App.tsx (track A4).
import { Modal } from '../ui/Modal';
import { RepoConnect, type RepoSpec } from './CreateProjectModal';
import { cleanErr, slugifyName } from '../lib/text';
import { nm as nmBridge } from '../bridge/nm';
import { type ChannelRow } from '../bridge/rows-rooms';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function AddRepoModal({ channelSlug, onClose, onAdded }: { channelSlug?: string; onClose: () => void; onAdded?: (repoId: string) => void }) {
  const [spec, setSpec] = useState<RepoSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const onChange = useCallback((s: RepoSpec | null) => setSpec(s), []);
  const submit = async () => {
    if (!nm || !spec || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await nm.repoAdd({ ...spec, channelSlug });
      onAdded?.(r.repoId);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 160) : 'could not connect repo');
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Connect a repository"
      onClose={onClose}
      stack
      footer={
        <>
          <button className="btn sm" onClick={onClose}>Cancel</button>
          <button className="btn primary sm" disabled={!spec || busy} onClick={() => void submit()}>{busy ? 'Connecting…' : 'Connect'}</button>
        </>
      }
    >
      <p className="modalhint">Connect a GitHub or GitLab repo, or pick a local folder. Tasks branch off it for review; a local folder also sets your code-viewer home. No tokens are stored — your machine's own git credentials authenticate.</p>
      <RepoConnect onChange={onChange} />
      {err && <div className="acterr" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}



// Create a project (the work axis): a workspace-scoped initiative that OWNS its
// channels (1:N). You may move existing channels into it now, or add/create later.
// One node in the code workspace's file tree. Directories lazy-load their children
// from the root-scoped fs IPC on first expand; files open into the read pane.

// Create a fresh room in the active project. Slug is unique per project — the server
// appends -2/-3 on collision; we never block on it here.
export function CreateChannelModal({ projectId, projectName, onClose, onCreated }: { projectId: string; projectName: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [slug, setSlug] = useState('');
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const onSlug = (v: string) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const finalSlug = slugifyName(slug);
  const valid = finalSlug.length > 0;
  const submit = async () => {
    if (!nm || !valid || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await nm.channelCreate(projectId, finalSlug, topic.trim() || undefined);
      onCreated(r.channelId);
      onClose();
    } catch (e) { setErr(cleanErr(e, 'could not create channel')); setBusy(false); }
  };
  return (
    <Modal
      title="New channel"
      onClose={onClose}
      footer={<button className="btn primary sm" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create channel'}</button>}
    >
      <p className="modalhint">A channel is where a team works and agents register. It belongs to <b>{projectName}</b> — its name is unique within this project.</p>
      <div className="fld">
        <label>Channel name</label>
        <input autoFocus value={slug} onChange={(e) => onSlug(e.target.value)} placeholder="design" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      <div className="fld">
        <label>Topic — optional</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What this channel is for" maxLength={280} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      </div>
      {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}

// Channel (room) settings: rename (name + topic) and delete. A channel is identified by
// its id, so renaming the slug is safe (everything refs the uuid). Delete is gated behind a
// type-the-name confirmation — it permanently destroys the room's messages, tasks & history.
export function ChannelSettingsModal({ channel, onClose, onChanged, onDeleted }: { channel: ChannelRow; onClose: () => void; onChanged: () => void; onDeleted: (id: string) => void }) {
  const [slug, setSlug] = useState(channel.slug);
  const [topic, setTopic] = useState(channel.topic ?? '');
  // kind applies immediately — what the room is FOR (build board vs marketing HQ), human-only
  const [kind, setKind] = useState<'build' | 'marketing'>(channel.kind === 'marketing' ? 'marketing' : 'build');
  const setRoomKind = (k: 'build' | 'marketing') => { if (k === kind) return; setKind(k); void nm?.channelKind(channel.id, k); };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slugInput, setSlugInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const onSlug = (v: string) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const finalSlug = slugifyName(slug);
  const slugChanged = finalSlug !== channel.slug;
  const topicChanged = (topic ?? '') !== (channel.topic ?? '');
  const dirty = slugChanged || topicChanged;
  const valid = finalSlug.length > 0;
  const save = async () => {
    if (!nm || busy || !valid || !dirty) return;
    setBusy(true); setErr('');
    try {
      await nm.channelRename(channel.id, slugChanged ? finalSlug : undefined, topicChanged ? topic.trim() : undefined);
      onChanged();
      onClose();
    } catch (e) { setErr(cleanErr(e, 'could not save channel')); setBusy(false); }
  };
  const doDelete = async () => {
    if (!nm || deleting || slugInput.trim() !== channel.slug) return;
    setDeleting(true); setErr('');
    try { await nm.channelDelete(channel.id); onDeleted(channel.id); }
    catch (e) { setErr(cleanErr(e, 'could not delete channel')); setDeleting(false); }
  };
  // type-the-name confirmation, shown in place of the settings when Delete is clicked
  if (confirmDelete) {
    const slugMatch = slugInput.trim() === channel.slug;
    const back = () => { setConfirmDelete(false); setSlugInput(''); setErr(''); };
    return (
      <Modal
        title={`Delete #${channel.slug}?`}
        onClose={back}
        footer={
          <>
            <button className="btn sm" style={{ marginRight: 'auto' }} disabled={deleting} onClick={back}>Back</button>
            <button className="btn danger sm" style={{ width: 'auto', marginTop: 0, padding: '5.5px 16px' }} disabled={deleting || !slugMatch} onClick={() => void doDelete()}>{deleting ? 'Deleting…' : 'Delete forever'}</button>
          </>
        }
      >
        <p className="modalhint">This <b>permanently deletes</b> the channel <b>#{channel.slug}</b> and everything in it — every message, task, artifact, and audit record under it. <b style={{ color: 'var(--blocked)' }}>This can’t be undone.</b></p>
        <div className="fld">
          <label>Type the channel name <code>{channel.slug}</code> to confirm</label>
          <input autoFocus value={slugInput} onChange={(e) => setSlugInput(e.target.value)} placeholder={channel.slug}
            onKeyDown={(e) => { if (e.key === 'Enter' && slugMatch) void doDelete(); }} />
        </div>
        {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
      </Modal>
    );
  }
  return (
    <Modal
      title="Channel settings"
      onClose={onClose}
      subtitle={`#${channel.slug}`}
      footer={
        <>
          <button className="btn danger sm" style={{ marginRight: 'auto' }} title="delete channel" disabled={busy} onClick={() => { setSlugInput(''); setErr(''); setConfirmDelete(true); }}>Delete channel</button>
          <button className="btn primary sm" style={{ width: 'auto', marginTop: 0, padding: '5.5px 16px' }} disabled={busy || !valid || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <div className="fld"><label>Channel name</label>
        <input autoFocus value={slug} onChange={(e) => onSlug(e.target.value)} placeholder="design" /></div>
      <div className="fld"><label>Topic</label>
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What this channel is for" maxLength={280} /></div>
      {/* the docs/20 Threads row retired with the feed (docs/35 §6): a room lists its
          conversations, so there is no lens left to choose. */}
      <div className="fld"><label>Kind</label>
        <div className="threadseg" role="group" aria-label="Channel kind">
          <button type="button" className={kind === 'build' ? 'on' : ''} onClick={() => setRoomKind('build')}>Build · board</button>
          <button type="button" className={kind === 'marketing' ? 'on' : ''} onClick={() => setRoomKind('marketing')}>Marketing · HQ</button>
        </div>
        <p className="fldhint">{kind === 'marketing'
          ? 'This channel runs the growth HQ — the marketing crew, brand docs, calendar and library. Same channel, same history.'
          : 'This channel runs the build loop — chat, board and the task workflow. The default.'}</p>
      </div>
      {kind === 'marketing' && <MarketingIntegrations channel={channel} />}
      <p className="modalhint" style={{ marginTop: 4 }}>Renaming is safe — a channel is identified internally, so its tasks, messages, agents, and history all follow the new name.</p>
      {err && <div className="acterr" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}

// Marketing MCP integrations (integrations-and-skills-plan.md P1/P2): the toggle is a
// synced room fact (marketing.mcp.<provider>); the credential is MACHINE-LOCAL — saved via
// IPC to userData, never synced, never on our server. Presence badges only; keys are
// write-only from this UI. PostHog + X ride their documented hosted servers; Meta's beta
// connector needs the account-scoped URL from its Ads console beside the token.
// X is deliberately ABSENT (2026-08-09): reading X rides the room's X CONNECTOR now, so a
// second X credential here would be the two-connectors confusion in another surface.
export const MK_INTEGRATIONS: Array<['posthog' | 'meta', string, string]> = [
  ['posthog', 'PostHog', 'analytics grounding for docs + weekly reports'],
  ['meta', 'Meta Ads', 'campaign context — beta connector URL + token'],
];

export function MarketingIntegrations({ channel }: { channel: ChannelRow }) {
  const mcp = useMemo(() => {
    try { return ((JSON.parse(channel.marketing ?? '{}') as { mcp?: Record<string, boolean> }).mcp ?? {}); } catch { return {}; }
  }, [channel.marketing]);
  const [on, setOn] = useState<Record<string, boolean>>(mcp);
  const [presence, setPresence] = useState<Record<'posthog' | 'meta' | 'instagram' | 'tiktok', boolean>>({ posthog: false, meta: false, instagram: false, tiktok: false });
  const [metaUrl, setMetaUrl] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { void nm?.mcpKeys().then((r) => { setPresence(r.presence); setMetaUrl(r.metaUrl); }).catch(() => {}); }, []);
  const toggle = (p: 'posthog' | 'meta') => {
    const next = !on[p];
    setOn((prev) => ({ ...prev, [p]: next }));
    void nm?.marketingIntegration(channel.id, p, next).catch(() => setOn((prev) => ({ ...prev, [p]: !next })));
  };
  const saveKey = (p: 'posthog' | 'meta') => {
    const v = (draft[p] ?? '').trim();
    if (!v) return;
    void nm?.mcpKeySet(p, v).then((r) => { setPresence(r.presence); setDraft((d) => ({ ...d, [p]: '' })); }).catch(() => {});
  };
  return (
    <div className="fld"><label>Integrations — research context</label>
      {MK_INTEGRATIONS.map(([p, label, hint]) => (
        <div key={p} className="mkintrow">
          <button type="button" role="switch" aria-checked={!!on[p]} className={`mkinttoggle${on[p] ? ' on' : ''}`} onClick={() => toggle(p)} aria-label={`${label} enabled`}><i /></button>
          <span className="mkintname"><b>{label}</b><span>{hint}</span></span>
          {presence[p]
            ? <span className="mkintok">✓ key on this machine</span>
            : (
              <span className="mkintkey">
                <input type="password" value={draft[p] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [p]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(p); }} placeholder={p === 'meta' ? 'access token' : 'API key / bearer'} aria-label={`${label} key`} />
                <button type="button" className="btn sm" onClick={() => saveKey(p)}>Save</button>
              </span>
            )}
        </div>
      ))}
      {(on['meta'] || presence.meta) && (
        <div className="mkintrow mkinturl">
          <span className="mkintname"><b>Meta connector URL</b><span>from the Ads console (beta)</span></span>
          <span className="mkintkey">
            <input value={metaUrl} onChange={(e) => setMetaUrl(e.target.value)} onBlur={() => { void nm?.mcpKeySet('metaUrl', metaUrl).catch(() => {}); }} placeholder="https://…" aria-label="Meta connector URL" />
          </span>
        </div>
      )}
      <p className="fldhint">Keys live on this machine only — never synced, never on neuramesh servers. Enabled servers attach to the crew's research runs; publishing still waits for your approve.</p>
    </div>
  );
}
