// THE FIRST-RUN DOORS (2026-09-19, docs/design/first-run-doors-2026-09): the screen a fresh
// install sees BEFORE anything builds. The shipped app makes the Local connection first and the
// cloud only once a Clerk session is stored, so a person with an account and no stored session
// was walked into the local wizard (George, v0.138.0). The door asks first: This Mac (the stack
// starts, then the local wizard), The cloud (the hosted sign-up hand-off, then the wizard resumes
// on the workspace the server made), or Sign in (the hosted sign-in hand-off, then their
// workspaces). Nothing downloads and no container starts until a row is chosen.
//
// Pure: the electron half (firstrunipc.ts) hands in the browser, the stack and the landing.
import { pollDesktopAuth, startDesktopAuth, type HandoffSession } from './upgrade';

export type FirstRunDoor = 'local' | 'cloud' | 'signin';
export type FirstRunState =
  | { phase: 'choose' }
  | { phase: 'waiting'; door: 'cloud' | 'signin'; url: string }
  | { phase: 'landing'; door: 'cloud' | 'signin' }
  | { phase: 'expired'; door: 'cloud' | 'signin' }
  | { phase: 'error'; door: FirstRunDoor; message: string }
  | { phase: 'done'; door: FirstRunDoor | null };

/**
 * A fresh profile: no stored session, no chosen connection, this Mac never ran the stack (its
 * `.env` does not exist) and no server added by hand. Every other profile keeps today's rule: the
 * cloud in front when a session exists, else the local stack.
 */
export function isFreshProfile(f: { clerkSignedIn: boolean; storedForeground: string | null; localUsedBefore: boolean; custom: number }): boolean {
  return !f.clerkSignedIn && f.storedForeground === null && !f.localUsedBefore && f.custom === 0;
}

/** the hand-off page for each cloud door: the sign-in face, or the sign-up face (the phone's lane, D15) */
export function handoffPageUrl(webUrl: string, nonce: string, door: 'cloud' | 'signin'): string {
  const u = new URL('/desktop-signin', webUrl);
  u.searchParams.set('nonce', nonce);
  if (door === 'cloud') u.searchParams.set('mode', 'signup');
  return u.toString();
}

export interface FirstRunDeps {
  fetchImpl: typeof fetch;
  /** the cloud's API and web addresses (upgradeipc.ts cloudSpec) */
  apiUrl: string;
  webUrl: string;
  openExternal: (url: string) => Promise<void>;
  /** This Mac: start the stack driver, boot the dormant Local, put it in front */
  startLocal: () => Promise<void>;
  /** the cloud doors: save the session, add the cloud connection, put it in front */
  land: (session: HandoffSession) => Promise<void>;
  onState: (s: FirstRunState) => void;
  log: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** the poll's budget: the server nonce's fifteen minutes unless a test says otherwise */
  timeoutMs?: number;
  everyMs?: number;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export class FirstRun {
  state: FirstRunState;
  private current: { nonce: string; url: string; cancelled: boolean } | null = null;

  constructor(private readonly d: FirstRunDeps, fresh: boolean) {
    this.state = fresh ? { phase: 'choose' } : { phase: 'done', door: null };
  }

  private emit(s: FirstRunState): void {
    this.state = s;
    this.d.log(`first_run phase=${s.phase}${'door' in s && s.door ? ` door=${s.door}` : ''}${s.phase === 'error' ? ` message=${JSON.stringify(s.message)}` : ''}`);
    this.d.onState(s);
  }

  /** a row chosen, or Sign in pressed. A second press while the browser is open re-opens the same page. */
  async choose(door: FirstRunDoor): Promise<void> {
    if (this.state.phase === 'done' || this.state.phase === 'landing') return;
    if (door === 'local') {
      try { await this.d.startLocal(); this.emit({ phase: 'done', door }); } catch (err) { this.emit({ phase: 'error', door, message: message(err) }); }
      return;
    }
    if (this.current && !this.current.cancelled) { await this.d.openExternal(this.current.url); return; }
    // a dev build with no cloud address says so (upgradeipc.ts says the same for Get Pro)
    if (!this.d.apiUrl) { this.emit({ phase: 'error', door, message: 'The cloud address is not set. This build cannot open the cloud.' }); return; }
    try {
      const start = await startDesktopAuth(this.d.fetchImpl, this.d.apiUrl);
      const url = handoffPageUrl(this.d.webUrl, start.nonce, door);
      this.current = { nonce: start.nonce, url, cancelled: false };
      await this.d.openExternal(url);
      this.emit({ phase: 'waiting', door, url });
      const mine = () => this.current?.nonce === start.nonce && !this.current.cancelled;
      const out = await pollDesktopAuth({ fetchImpl: this.d.fetchImpl, apiUrl: this.d.apiUrl, start, sleep: this.d.sleep, now: this.d.now, cancelled: () => !mine(), timeoutMs: this.d.timeoutMs, everyMs: this.d.everyMs });
      if (out.status === 'cancelled') return;
      this.current = null;
      if (out.status === 'expired' || out.status === 'timeout') { this.emit({ phase: 'expired', door }); return; }
      this.emit({ phase: 'landing', door });
      await this.d.land(out.session);
      this.emit({ phase: 'done', door });
    } catch (err) {
      this.current = null;
      this.emit({ phase: 'error', door, message: message(err) });
    }
  }

  /** the wait card's "Open the page again" */
  async reopen(): Promise<void> {
    if (this.current && !this.current.cancelled) await this.d.openExternal(this.current.url);
  }

  /** the wait card's Cancel, and the expired card's: back to the door, the old nonce forgotten */
  cancel(): void {
    if (this.state.phase === 'done' || this.state.phase === 'landing') return;
    if (this.current) this.current.cancelled = true;
    this.current = null;
    this.emit({ phase: 'choose' });
  }
}
