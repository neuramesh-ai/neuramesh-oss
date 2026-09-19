// Marketing OS home bits (the founder's production review, 2026-08-21): the per-card
// connector strip, the Run-for picker that replaced the inert "pick a project" label, and
// the small state renderers the desk shares. Split from MarketingOS.tsx (the line cap).
import { useEffect, useState, type ReactNode } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { ConnectorMark } from '../settings/connector-marks';
import type { ConnectorId } from '../settings/connectors';
import { IconAnchor, IconBranch, IconCompass, IconCrosshair, IconFlask, IconGauge, IconGlobe, IconMail, IconPhone, IconRadar, IconRocket, IconSpeaker, IconUser } from '../ui/icons';
import type { ConnectorRow } from '../bridge/rows-content';
import type { Playbook } from '@neuramesh/shared';

const nm = nmBridge;

export interface RoomPlaybookState { lastAt: string | null; lastScore: number | null; armed: string | null }

export function whenShort(iso: string | null): string {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const days = Math.floor(d / 86_400_000);
  return days <= 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
}

export function Dial({ score, size = 24 }: { score: number; size?: number }) {
  return (
    <span className="gdial" style={{ width: size, height: size, ['--frac' as never]: String(score / 100) }} aria-hidden />
  );
}

export function stateMeta(pb: Playbook, s: RoomPlaybookState | undefined): React.ReactNode {
  if (s?.armed) return <span className="pbarmed">armed · {s.armed}</span>;
  if (s?.lastScore != null) return <span className="pbscore"><Dial score={s.lastScore} size={14} />{s.lastScore} <i className="pbwhen">{whenShort(s.lastAt)}</i></span>;
  if (s?.lastAt) return <span className="pbwhen">{whenShort(s.lastAt)}</span>;
  return <span className="pbnever">never run</span>;
}

/** each marketing room's connector rows — the same read the AlertsBar derives from, so the
 *  strip's amber dot and the attention bar can never disagree about one account */
export function useRoomConnectors(roomIds: string[]): Map<string, ConnectorRow[]> {
  const [by, setBy] = useState<Map<string, ConnectorRow[]>>(new Map());
  const key = roomIds.join(',');
  useEffect(() => {
    let live = true;
    const load = async () => {
      const next = new Map<string, ConnectorRow[]>();
      for (const id of key ? key.split(',') : []) {
        const r = await nm?.connectors(id).catch(() => null);
        if (r) next.set(id, r.connectors);
      }
      if (live) setBy(next);
    };
    void load();
    const iv = setInterval(() => void load(), 12_000);
    return () => { live = false; clearInterval(iv); };
  }, [key]);
  return by;
}

const STRIP: Array<{ p: ConnectorId; label: string }> = [
  { p: 'x', label: 'X' },
  { p: 'linkedin', label: 'LinkedIn' },
  { p: 'instagram', label: 'Instagram' },
  { p: 'tiktok', label: 'TikTok' },
];
const STATE_WORD = { on: 'connected', warnc: 'reconnect needed', '': 'not connected' } as const;

/** the catalog's glyphs — literal marks, one per playbook (ui/icons.tsx), so a row says its kind before its title is read */
export const PLAYBOOK_GLYPH: Record<string, ReactNode> = {
  audit: <IconGauge s={15} />, geo: <IconGlobe s={15} />, teardown: <IconCrosshair s={15} />, positioning: <IconCompass s={15} />,
  engage: <IconRadar s={15} />, copylab: <IconFlask s={15} />, hooks: <IconAnchor s={15} />, email: <IconMail s={15} />,
  launch: <IconRocket s={15} />, ads: <IconSpeaker s={15} />, appstore: <IconPhone s={15} />,
  release: <IconBranch s={15} />, ugc: <IconUser s={15} />,
};

/** the tile's one-glance connector row: publish networks + PostHog as the composer foot's marks, live status dots */
export function ConnStrip({ conns, marketing }: { conns: ConnectorRow[]; marketing?: string | null }) {
  const posthog = ((): boolean => {
    try { return !!(JSON.parse(marketing ?? '{}') as { mcp?: { posthog?: boolean } }).mcp?.posthog; } catch { return false; }
  })();
  const stat = (p: string): 'on' | 'warnc' | '' => {
    const row = conns.find((c) => c.provider === p);
    if (!row) return '';
    return row.status === 'connected' ? 'on' : row.status === 'reauth_required' ? 'warnc' : '';
  };
  const live = STRIP.filter((s) => stat(s.p) === 'on').length + (posthog ? 1 : 0);
  const warn = STRIP.filter((s) => stat(s.p) === 'warnc').length;
  return (
    <span className="mkconns">
      {STRIP.map((s) => {
        const st = stat(s.p);
        return <span key={s.p} className={`mkc${st ? ` ${st}` : ''}`} data-tip={`${s.label}: ${STATE_WORD[st]}`}><ConnectorMark id={s.p} s={13} /></span>;
      })}
      <span className={`mkc${posthog ? ' on' : ''}`} data-tip={`PostHog: ${posthog ? 'connected' : 'not connected'}`}><ConnectorMark id="posthog" s={13} /></span>
      <span className="mkconnlbl">{live ? `${live} live` : 'nothing connected'}{warn ? ` · ${warn} needs re-auth` : ''}</span>
    </span>
  );
}

export interface RunForRow {
  projectId: string;
  name: string;
  logo: string | null;
  roomId: string;
  ready: boolean;
  setupTaskId: string | null;
  state: RoomPlaybookState | undefined;
}

/** the picker that replaced "pick a project" (founder: direction, not usability) — the row
 *  itself asks for the missing argument; a not-set-up room shows dimmed with its reason and
 *  clicks through to the setup task instead of being hidden */
export function RunForPop({ pb, rows, onPick, onOpenTask, onClose }: {
  pb: Playbook;
  rows: RunForRow[];
  onPick: (roomId: string) => void;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <button className="runforveil" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }} />
      <div className="runforpop" onClick={(e) => e.stopPropagation()}>
        <div className="runforh">Run {pb.title} for</div>
        {rows.map((r) => r.ready ? (
          <button key={r.projectId} className="runforrow" onClick={() => { onClose(); onPick(r.roomId); }}>
            <span className="mklogo2">{r.logo ? <img src={r.logo} alt="" /> : (r.name[0] ?? '?').toUpperCase()}</span>
            <b>{r.name}</b>
            <span className="rst">{stateMeta(pb, r.state)}</span>
          </button>
        ) : (
          <button key={r.projectId} className="runforrow off" onClick={() => { onClose(); if (r.setupTaskId) onOpenTask(r.setupTaskId); }}>
            <span className="mklogo2">{(r.name[0] ?? '?').toUpperCase()}</span>
            <b>{r.name}</b>
            <span className="rst">finish setup first</span>
          </button>
        ))}
      </div>
    </>
  );
}
