// THE STACK STATE MACHINE — the seven states the first-run card renders (artboards A1 to A6) and
// the events that move between them. Pure: the orchestration (index.ts) spawns and polls, this
// decides what the person sees. Every string a person reads is on the state, so the renderer
// draws and never composes.
import type { EngineKind, EngineProbe } from './engine';
import type { Runtime } from './install';

export interface ProgressItem {
  name: string;
  bytes: number;
  /** null until the total is known — a bar with no total draws as indeterminate, never a clock */
  total: number | null;
  done: boolean;
}

/** a container's place in the boot order, as `docker inspect` reports it: not yet started (it waits
 *  on the one above it), running but not healthy, healthy, or exited into its restart loop */
export type ServiceStatus = 'queued' | 'starting' | 'ready' | 'stopped';
export interface ServiceItem { name: string; status: ServiceStatus; restarts: number }

export type StackState =
  /** before the first probe answers: the shell draws its splash, never the picker (a picker that
   *  flashes for the two seconds Docker takes to answer asks a question it is about to withdraw) */
  | { phase: 'probing' }
  | { phase: 'no-engine'; picked: Runtime }
  | { phase: 'installing'; runtime: Runtime; items: ProgressItem[]; vm: 'pending' | 'starting' | 'ready' }
  | { phase: 'engine-starting'; engine: EngineKind }
  | { phase: 'downloading'; items: ProgressItem[] }
  | { phase: 'starting'; services: ServiceItem[] }
  | { phase: 'updating'; version: string; items: ProgressItem[] }
  | { phase: 'ready'; version: string; engine: EngineKind }
  /** `message` is the cause in plain words. `detail` is the container's own last line (or the port
   *  and who holds it), `remedy` what Try again will do — both optional: an error with no diagnosis
   *  (Colima did not start.) draws the two-line card. */
  | { phase: 'error'; message: string; detail?: string; remedy?: string; from: StackState['phase'] };

export type StackEvent =
  | { type: 'probed'; probe: EngineProbe }
  | { type: 'pick'; runtime: Runtime }
  | { type: 'install.begin'; runtime: Runtime; items: string[] }
  | { type: 'install.progress'; name: string; bytes: number; total: number }
  | { type: 'install.vm'; vm: 'starting' | 'ready' }
  | { type: 'engine.starting'; engine: EngineKind }
  | { type: 'pull.begin'; items: string[]; version: string; update: boolean }
  | { type: 'pull.progress'; name: string; bytes: number; total: number | null }
  | { type: 'pull.done'; name: string }
  | { type: 'up'; services: string[] }
  | { type: 'service'; service: string; status: ServiceStatus; restarts?: number }
  | { type: 'ready'; version: string; engine: EngineKind }
  | { type: 'error'; message: string; detail?: string; remedy?: string };

export const initialState = (): StackState => ({ phase: 'probing' });

const withProgress = (items: ProgressItem[], name: string, bytes: number, total: number | null): ProgressItem[] =>
  items.map((it) => (it.name === name ? { ...it, bytes, total, done: total !== null && bytes >= total } : it));

export function reduce(state: StackState, ev: StackEvent): StackState {
  switch (ev.type) {
    case 'probed':
      // a running engine moves on to the stack; a stopped one starts; none asks which to install
      if (ev.probe.running) return state.phase === 'ready' ? state : { phase: 'starting', services: [] };
      if (ev.probe.engine) return { phase: 'engine-starting', engine: ev.probe.engine };
      return { phase: 'no-engine', picked: state.phase === 'no-engine' ? state.picked : 'colima' };
    case 'pick':
      return state.phase === 'no-engine' ? { ...state, picked: ev.runtime } : state;
    case 'install.begin':
      return { phase: 'installing', runtime: ev.runtime, items: ev.items.map((name) => ({ name, bytes: 0, total: null, done: false })), vm: 'pending' };
    case 'install.progress':
      return state.phase === 'installing' ? { ...state, items: withProgress(state.items, ev.name, ev.bytes, ev.total) } : state;
    case 'install.vm':
      return state.phase === 'installing' ? { ...state, vm: ev.vm } : state;
    case 'engine.starting':
      return { phase: 'engine-starting', engine: ev.engine };
    case 'pull.begin': {
      const items = ev.items.map((name) => ({ name, bytes: 0, total: null, done: false }));
      return ev.update ? { phase: 'updating', version: ev.version, items } : { phase: 'downloading', items };
    }
    case 'pull.progress':
      if (state.phase === 'downloading' || state.phase === 'updating') return { ...state, items: withProgress(state.items, ev.name, ev.bytes, ev.total) };
      return state;
    case 'pull.done':
      if (state.phase === 'downloading' || state.phase === 'updating') return { ...state, items: state.items.map((it) => (it.name === ev.name ? { ...it, bytes: it.total ?? it.bytes, done: true } : it)) };
      return state;
    case 'up':
      return { phase: 'starting', services: ev.services.map((name) => ({ name, status: 'queued', restarts: 0 })) };
    case 'service':
      return state.phase === 'starting' ? { ...state, services: state.services.map((s) => (s.name === ev.service ? { ...s, status: ev.status, restarts: ev.restarts ?? s.restarts } : s)) } : state;
    case 'ready':
      return { phase: 'ready', version: ev.version, engine: ev.engine };
    case 'error':
      return { phase: 'error', message: ev.message, ...(ev.detail ? { detail: ev.detail } : {}), ...(ev.remedy ? { remedy: ev.remedy } : {}), from: state.phase === 'error' ? state.from : state.phase };
  }
}

/** the states that take the whole screen. `engine-starting` and `starting` on a warm boot draw as
 *  the sync mark instead (review F9: the shell renders from the replica while the stack comes up) */
export function blocks(state: StackState, warm: boolean): boolean {
  switch (state.phase) {
    case 'ready': return false;
    case 'engine-starting':
    case 'starting': return !warm;
    default: return true;
  }
}

/** "About 900 MB" once the totals are known — the number, never a clock */
export function aboutMb(items: ProgressItem[]): number | null {
  if (!items.length || items.some((i) => i.total === null)) return null;
  return Math.round(items.reduce((n, i) => n + (i.total ?? 0), 0) / 1e6);
}

/**
 * The version gate (review F7): a stack behind the app is refused, never a half-working shell.
 * Numeric segments compared, non-numeric suffixes ignored; an unreadable version is refused too.
 */
export function stackBehind(stackVersion: string | null | undefined, appVersion: string): boolean {
  if (!stackVersion) return true;
  const parts = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(stackVersion);
  const b = parts(appVersion);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
