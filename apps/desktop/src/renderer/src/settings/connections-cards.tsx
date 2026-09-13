// THE CONNECTIONS CARDS — one card per connection (Settings › Connections, artboard D; docs/33 §8).
// The panel (ConnectionsPanel.tsx) reads and decides; these draw. Three recipes: `.cxcard` on the
// elevated stratum, `.cxhead` (glyph · name · a mono status · the actions), and `.cxrow` (a 96px
// key column and a value that may carry a code, a tag, a link or a sub-line).
import { planLabel } from '@neuramesh/shared';
import type { ConnectionCard, ConnectionWorkspace, LocalStackInfo, LocalStackPayload, MovedMarker } from '../bridge/nm';
import { MOVE_COPY, type MoveDoor } from '../shell/move-copy';
import { IconCloud, IconMachine, IconServer } from '../ui/icons';

const ENGINE_LABEL: Record<string, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop', other: 'Docker' };

/** every sentence a person reads on these cards (CLAUDE.md #11) — the artboard's words */
export const CONNECTIONS_COPY = {
  mac: { name: 'This Mac', runs: 'runs', wait: 'please wait…', restart: 'Restart', engine: 'Engine', stack: 'Stack', upToDate: 'up to date', data: 'Data', show: 'Show in Finder', ports: 'Ports', afterQuit: 'After quit', keep: 'Keep the stack running', keepSub: 'Routines run only while the stack runs.' },
  cloud: { name: 'neuramesh.app', connected: 'connected', signOut: 'Sign out', account: 'Account', plan: 'Plan', seats: (n: number) => `${n} ${n === 1 ? 'seat' : 'seats'}`, billing: 'Manage billing', status: 'Status', renews: 'Renews', workspaces: 'Workspaces', door: 'Pro is the hosted cloud around this Mac.', get: 'Get Pro' },
  custom: { remove: 'Remove', address: 'Address', workspaces: 'Workspaces' },
  manual: { name: 'Manual setup', sub: 'Run the stack yourself, from a terminal or on a server you own.', api: 'API URL', powersync: 'PowerSync URL', bearer: 'Bearer', connect: 'Connect', busy: 'Please wait…' },
} as const;

export function Row({ k, children, sub }: { k: string; children: React.ReactNode; sub?: string }) {
  return (
    <div className="cxrow">
      <span className="cxk">{k}</span>
      <span className="cxv">{children}{sub && <span className="cxsub">{sub}</span>}</span>
    </div>
  );
}

function Head({ icon, name, status, live, children }: { icon: React.ReactNode; name: string; status?: string; live?: boolean; children?: React.ReactNode }) {
  return (
    <div className="cxhead">
      <span className="cxico">{icon}</span>
      <span className="cxname">{name}</span>
      {status && <span className="cxst">{live && <span className="cxdot" aria-hidden />}{status}</span>}
      <span className="cxgrow" />
      {children}
    </div>
  );
}

/** the home folder abbreviated the way a Mac shows it — the full path stays on the title */
const homeShort = (p: string): string => p.replace(/^\/(Users|home)\/[^/]+/, '~');

const movedOn = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** `door` is the panel's ruling (move-copy.ts moveDoorFor): 'none' draws no button, an absent control beats a disabled one */
export function ThisMacCard({ info, stack, keep, busy, door, moved, onKeep, onRestart, onShow, onMove, onOpenMoved }: {
  info: LocalStackInfo | null; stack: LocalStackPayload | null; keep: boolean; busy: boolean; door: MoveDoor; moved?: MovedMarker;
  onKeep: (v: boolean) => void; onRestart: () => void; onShow: (path: string) => void; onMove: () => void; onOpenMoved: () => void;
}) {
  const c = CONNECTIONS_COPY.mac;
  const ready = stack?.state.phase === 'ready';
  const engine = info?.engine ? ENGINE_LABEL[info.engine] ?? 'Docker' : null;
  return (
    <div className="cxcard">
      <Head icon={<IconMachine s={15} />} name={c.name} status={ready ? c.runs : c.wait} live={ready}>
        {door !== 'none' && <button type="button" className="btn sm" onClick={onMove}>{MOVE_COPY.card.door}</button>}
        <button type="button" className="btn sm" disabled={!ready || busy} onClick={onRestart}>{busy ? c.wait : c.restart}</button>
      </Head>
      {moved && <Row k={MOVE_COPY.card.moved}>{moved.target.name} · {movedOn(moved.movedAt)}<button type="button" className="cxlnk" onClick={onOpenMoved}>{MOVE_COPY.card.open}</button></Row>}
      <Row k={c.engine}>{engine ? `${engine}${info?.engineVersion ? ` ${info.engineVersion}` : ''}` : '…'}</Row>
      <Row k={c.stack}>{info?.stackVersion ?? '…'}{info?.stackVersion && info.stackVersion === info.appVersion && <span className="cxtag">{c.upToDate}</span>}</Row>
      <Row k={c.data}>{info ? <><code title={info.dir}>{homeShort(info.dir)}</code><button type="button" className="cxlnk" onClick={() => onShow(info.dir)}>{c.show}</button></> : '…'}</Row>
      <Row k={c.ports}>{info ? <><code>127.0.0.1:{info.ports.api}</code><code>127.0.0.1:{info.ports.powersync}</code></> : '…'}</Row>
      <div className="cxrow">
        <span className="cxk">{c.afterQuit}</span>
        <span className="cxv">{c.keep}<span className="cxsub">{c.keepSub}</span></span>
        <button type="button" className={`shsw${keep ? ' on' : ''}`} role="switch" aria-checked={keep} aria-label={c.keep} onClick={() => onKeep(!keep)}><i /></button>
      </div>
    </div>
  );
}

const renews = (iso: string): string => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function CloudCard({ card, busy, onSignOut, onBilling, onGetPro }: { card: ConnectionCard; busy: boolean; onSignOut: () => void; onBilling: () => void; onGetPro: () => void }) {
  const c = CONNECTIONS_COPY.cloud;
  const ws: ConnectionWorkspace | undefined = card.workspaces.find((w) => w.id === card.workspaceId) ?? card.workspaces[0];
  const pro = ws?.plan === 'cloud';
  return (
    <div className="cxcard">
      <Head icon={<IconCloud s={15} />} name={c.name} status={c.connected} live>
        <button type="button" className="btn sm" disabled={busy} onClick={onSignOut}>{busy ? CONNECTIONS_COPY.mac.wait : c.signOut}</button>
      </Head>
      <Row k={c.account}>{card.account?.email ?? '…'}</Row>
      <Row k={c.plan}>
        {ws ? planLabel(ws.plan) : '…'}{pro && ws?.seats != null && <> · {c.seats(ws.seats)}</>}
        {pro ? <button type="button" className="cxlnk" onClick={onBilling}>{c.billing}</button> : <button type="button" className="cxlnk" onClick={onGetPro}>{c.get}</button>}
      </Row>
      {pro && ws?.subscriptionStatus && <Row k={c.status}><span className={`bstat ${ws.subscriptionStatus}`}>{ws.subscriptionStatus}</span></Row>}
      {pro && ws?.currentPeriodEnd && <Row k={c.renews}>{renews(ws.currentPeriodEnd)}</Row>}
      <Row k={c.workspaces}>{card.workspaces.length ? card.workspaces.map((w) => w.name).join(', ') : '…'}</Row>
    </div>
  );
}

/** no cloud connection yet: the door (one line and the button) */
export function CloudDoor({ onGetPro }: { onGetPro: () => void }) {
  const c = CONNECTIONS_COPY.cloud;
  return (
    <div className="cxcard">
      <Head icon={<IconCloud s={15} />} name={c.name} />
      <div className="cxdoor">
        <p className="cxp">{c.door}</p>
        <button type="button" className="btn primary" onClick={onGetPro}>{c.get}</button>
      </div>
    </div>
  );
}

export function CustomCard({ card, busy, onRemove }: { card: ConnectionCard; busy: boolean; onRemove: () => void }) {
  const c = CONNECTIONS_COPY.custom;
  const host = (() => { try { return new URL(card.apiUrl).host; } catch { return card.apiUrl; } })();
  return (
    <div className="cxcard">
      <Head icon={<IconServer s={15} />} name={host} status={CONNECTIONS_COPY.cloud.connected} live>
        <button type="button" className="btn sm" disabled={busy} onClick={onRemove}>{busy ? CONNECTIONS_COPY.mac.wait : c.remove}</button>
      </Head>
      <Row k={c.address}><code>{card.apiUrl}</code></Row>
      <Row k={c.workspaces}>{card.workspaces.length ? card.workspaces.map((w) => w.name).join(', ') : '…'}</Row>
    </div>
  );
}
