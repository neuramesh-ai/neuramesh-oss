import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconClose, IconOverview } from '../ui/icons';
import { overviewState, overviewVisible, reconcileOverview, toggleOverview, overviewStorageKey, readOverviewPreferences, saveOverviewPreference } from './overview-state';
import './thread-overview.css';

export type OverviewItem = { id: string; label: string; detail?: string | undefined; focus?: 'pane' | 'attachment' | 'preserve'; icon?: ReactNode; iconDecorative?: boolean; tone?: 'attention' | undefined; open?: (() => void | Promise<(() => void) | void>) | undefined };
export type OverviewSection = { id: string; label: string; items: OverviewItem[] };
export type OverviewEnvironment = { workspace: string; owner: string | null; paneOpen: boolean; expanded: boolean; processes: OverviewItem[]; openLink: (url: string) => void };
export const ThreadOverviewEnvironment = createContext<OverviewEnvironment | null>(null);
const readPreferences = () => { try { return readOverviewPreferences(localStorage.getItem(overviewStorageKey)); } catch { return []; } };

export function useThreadOverview(owner: string, sections: OverviewSection[], enabled = true) {
  const env = useContext(ThreadOverviewEnvironment);
  const identity = JSON.stringify([env?.workspace, owner]);
  const paneOpen = env?.paneOpen ?? false;
  const expanded = env?.expanded ?? false;
  // the stored preference matters only when the owner changes, so it is read once for each owner
  const stored = useMemo(() => readPreferences().find(([key]) => key === identity)?.[1], [identity]);
  const [saved, setSaved] = useState(() => overviewState(identity, paneOpen, expanded, stored));
  const state = reconcileOverview(saved, identity, paneOpen, expanded, stored ?? 'auto');
  if (state !== saved) setSaved(state);
  // a boolean, so a resize that stays on one side of the line renders nothing
  const [wide, setWide] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const id = useId();
  const eligible = enabled && !!env && env.owner === owner;
  const allSections = [...sections, ...(env?.processes.length ? [{ id: 'processes', label: 'Processes', items: env.processes }] : [])].filter((s) => s.items.length);
  const visible = eligible && overviewVisible(state, wide, !!allSections.length);
  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    const measure = () => setWide(el.getBoundingClientRect().width >= 690);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(el);
    return () => observer.disconnect();
  }, [eligible]);
  const change = (show: boolean) => {
    const next = toggleOverview(state, !show);
    setSaved(next);
    if (!paneOpen) try { localStorage.setItem(overviewStorageKey, saveOverviewPreference(localStorage.getItem(overviewStorageKey), identity, next.preference)); } catch { /* Private mode still keeps the current preference in memory. */ }
  };
  const dismiss = () => { change(false); trigger.current?.focus(); };
  // Only a user opening the overview moves focus. Passive arrivals never steal the composer.
  const focusOnOpen = useRef(false);
  useLayoutEffect(() => {
    if (visible && focusOnOpen.current) { card.current?.focus(); focusOnOpen.current = false; }
  }, [visible]);
  const toggle = eligible ? <button ref={trigger} className={`navpin overview-toggle${visible ? ' on' : ''}`} aria-label="Thread overview" data-tip="Thread overview" aria-expanded={visible} aria-controls={id}
    onKeyDown={(e) => { if (e.key === 'Escape' && visible) { e.stopPropagation(); dismiss(); } }}
    onClick={() => { focusOnOpen.current = !visible; change(!visible); }}><IconOverview s={15} /></button> : null;
  return { owner: identity, id, env, visible, wide, eligible, container, card, toggle, dismiss, sections: allSections };
}
export type ThreadOverviewController = ReturnType<typeof useThreadOverview>;

function OverviewRow({ item, onNavigate }: { item: OverviewItem; onNavigate: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const open = async () => {
    if (!item.open) return;
    setBusy(true); setError(null);
    try {
      const result = item.open();
      if (result instanceof Promise) {
        const navigate = await result;
        if (alive.current) { navigate?.(); onNavigate(); }
      } else onNavigate();
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Unable to open this item.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const content = <>{item.icon && <span className="overview-icon" aria-hidden={item.iconDecorative ?? true}>{item.icon}</span>}<span className="overview-copy"><span>{item.label}</span>{item.detail && <small>{item.detail}</small>}</span></>;
  return <div className={`overview-item${item.tone ? ` ${item.tone}` : ''}`}>
    {item.open ? <button disabled={busy} aria-busy={busy} onClick={() => void open()}>{content}</button> : <div className="overview-fact">{content}</div>}
    {error && <small className="overview-error" role="alert">{error}</small>}
  </div>;
}
/** Wraps only the transcript. In a narrow conversation the card sits above the transcript, in flow, so it never
 * covers a message, an inline approval, the composer or the gate seat. */
export function ThreadOverviewBody({ overview: o, label, children }: { overview: ThreadOverviewController; label: string; children: ReactNode }) {
  return <div ref={o.container} className={`thread-overview-body${o.visible ? (o.wide ? ' with-overview' : ' with-inline-overview') : ''}`} onKeyDownCapture={(e) => {
    // only an Escape inside the card closes it: a field or a menu in the transcript keeps its own Escape
    if (e.key === 'Escape' && o.visible && o.card.current?.contains(e.target as Node)) { e.stopPropagation(); e.preventDefault(); o.dismiss(); }
  }}>
    <div className="thread-overview-transcript">{children}</div>
    {o.visible && <aside key={o.owner} id={o.id} ref={o.card} tabIndex={-1} aria-label="Thread overview" className={`thread-overview${o.wide ? '' : ' overview-inline'}`}>
      <div className="overview-head"><span>{label}</span><button aria-label="Hide thread overview" data-tip="Hide thread overview" onClick={o.dismiss}><IconClose s={12} /></button></div>
      {o.sections.length ? o.sections.map((section) => <OverviewSectionRows key={section.id} section={section} />) : <p className="overview-empty">Plans, files and activity appear here as this thread develops.</p>}
    </aside>}
  </div>;
}

function OverviewSectionRows({ section }: { section: OverviewSection }) {
  const [expanded, setExpanded] = useState(false);
  return <section aria-label={section.label}><h3>{section.label}</h3>{(expanded ? section.items : section.items.slice(0, 3)).map((item) => <OverviewRow key={item.id} item={item} onNavigate={() => {
    requestAnimationFrame(() => {
      if (item.focus === 'preserve') return;
      const destination = document.querySelector<HTMLElement>(item.focus === 'attachment' ? '.alightboxclose' : '.sidedockwrap[data-open="1"] .sdbody');
      if (destination && destination.getBoundingClientRect().width > 0 && !document.activeElement?.closest('.gateseat, [data-run]')) { destination.tabIndex = -1; destination.focus({ preventScroll: true }); }
    });
  }} />)}{section.items.length > 3 && <button className="overview-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer' : `Show all ${section.items.length}`}</button>}</section>;
}
