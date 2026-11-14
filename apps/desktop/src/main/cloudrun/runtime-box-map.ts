// Paths, streamed output and environment mapping across the box boundary.
import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { BOX_HOME, BOX_PATH, isEnvName, isSecretEnvName, looksLikeSecret } from './box';
import { BOX_BEARER_ENV, RELAY_TICKET_ENV } from './runtime-state';

export interface PathRule {
  host: string;
  box: string;
  /** map box → host too (the CLI's stdout). The home rule is one-way: /root means more than our home */
  reverse?: boolean;
  /** one file, not a tree (the bus shim) */
  file?: boolean;
}

const NAME_CHAR = 'A-Za-z0-9_.~\\-';
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Host ↔ box path mapping. A prefix matches only on a path boundary: `/nm/work` maps `/nm/work`,
 *  `/nm/work/x` and `"--add-dir=/nm/work/x"`, never `/nm/workspace` or `/a/nm/work`. */
export class PathMap {
  private readonly rules: PathRule[];
  private readonly toBoxRe: RegExp | null;
  private readonly toHostRe: RegExp | null;
  private readonly reverseRules: PathRule[];

  constructor(rules: readonly PathRule[]) {
    this.rules = rules.map((r) => {
      const host = r.host.replace(/\/+$/, '');
      const box = r.box.replace(/\/+$/, '');
      if (!host.startsWith('/') || !box.startsWith('/')) throw new Error(`A path rule must be absolute: ${r.host} → ${r.box}`);
      return { ...r, host, box };
    }).sort((a, b) => b.host.length - a.host.length);
    this.reverseRules = this.rules.filter((r) => r.reverse).sort((a, b) => b.box.length - a.box.length);
    this.toBoxRe = PathMap.regex(this.rules.map((r) => ({ p: r.host, file: !!r.file })));
    this.toHostRe = PathMap.regex(this.reverseRules.map((r) => ({ p: r.box, file: !!r.file })));
  }

  private static regex(items: Array<{ p: string; file: boolean }>): RegExp | null {
    if (!items.length) return null;
    const alts = items.map(({ p, file }) => `(${esc(p)})(?![${NAME_CHAR}${file ? '/' : ''}])`);
    return new RegExp(`(?<![${NAME_CHAR}/])(?:${alts.join('|')})`, 'g');
  }

  private static one(p: string, from: string, to: string, file: boolean | undefined): string | null {
    if (p === from) return to;
    if (!file && p.startsWith(`${from}/`)) return to + p.slice(from.length);
    return null;
  }

  /** an absolute host path in the box, or null when no rule covers it */
  toBox(p: string): string | null {
    for (const r of this.rules) { const m = PathMap.one(p, r.host, r.box, r.file); if (m !== null) return m; }
    return null;
  }

  /** an absolute box path on the host (reverse rules only), or null */
  toHost(p: string): string | null {
    for (const r of this.reverseRules) { const m = PathMap.one(p, r.box, r.host, r.file); if (m !== null) return m; }
    return null;
  }

  /** every host path inside a word (an argv word, an env value, a JSON config) */
  textToBox(s: string): string {
    if (!this.toBoxRe) return s;
    return s.replace(this.toBoxRe, (...m: unknown[]) => {
      const i = (m.slice(1, this.rules.length + 1) as Array<string | undefined>).findIndex((g) => g !== undefined);
      return this.rules[i]!.box;
    });
  }

  /** every box path inside a chunk of the CLI's output */
  textToHost(s: string): string {
    if (!this.toHostRe) return s;
    return s.replace(this.toHostRe, (...m: unknown[]) => {
      const i = (m.slice(1, this.reverseRules.length + 1) as Array<string | undefined>).findIndex((g) => g !== undefined);
      return this.reverseRules[i]!.host;
    });
  }
}

/** A line-buffered text transform, so a path split across two chunks is still mapped. A line longer
 *  than `maxHold`, and whatever is pending after `idleMs` of quiet, goes through as it is (a CLI that
 *  prints a partial line and waits must not stall). */
export function rewriteStream(fn: (s: string) => string, o: { maxHold?: number; idleMs?: number } = {}): Transform {
  const maxHold = o.maxHold ?? 1 << 20;
  const idleMs = o.idleMs ?? 100;
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = (): void => { if (timer) { clearTimeout(timer); timer = null; } };
  const t: Transform = new Transform({
    transform(chunk: Buffer | string, _enc, done) {
      clear();
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const cut = pending.lastIndexOf('\n');
      if (cut >= 0) { this.push(Buffer.from(fn(pending.slice(0, cut + 1)), 'utf8')); pending = pending.slice(cut + 1); }
      if (pending.length > maxHold) { this.push(Buffer.from(fn(pending), 'utf8')); pending = ''; }
      if (pending && idleMs > 0) {
        timer = setTimeout(() => { timer = null; if (pending) { t.push(Buffer.from(fn(pending), 'utf8')); pending = ''; } }, idleMs);
        timer.unref?.();
      }
      done();
    },
    flush(done) {
      clear();
      pending += decoder.end();
      if (pending) this.push(Buffer.from(fn(pending), 'utf8'));
      pending = '';
      done();
    },
  });
  return t;
}

// ── Loopback URLs ───────────────────────────────────────────────────────────────────────────────

/** The box cannot reach 127.0.0.1 (measured). A loopback URL whose port machined exposes on the veth
 *  IP is rewritten to it; any other loopback URL is left alone (and `hasLoopbackUrl` finds it). */
export class UrlRewrite {
  constructor(readonly hostIp: string, readonly ports: Map<number, number> = new Map()) {}

  private static RE = /\b(https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{1,5})(?![\d])/g;

  rewrite(s: string): string {
    return s.replace(UrlRewrite.RE, (all, scheme: string, port: string) => {
      const to = this.ports.get(Number(port));
      return to ? `${scheme}://${this.hostIp}:${to}` : all;
    });
  }

  static hasLoopbackUrl(s: string): boolean {
    UrlRewrite.RE.lastIndex = 0;
    const hit = UrlRewrite.RE.test(s);
    UrlRewrite.RE.lastIndex = 0;
    return hit;
  }

  /** a loopback URL in `s` (before the rewrite) whose port nothing exposes to the box. With the box
   *  link the rewritten URL is loopback too (the box's own, which the link carries back), so the test
   *  is on the source: a mapped port is reachable, an unmapped one is not */
  unmapped(s: string): boolean {
    for (const m of s.matchAll(UrlRewrite.RE)) if (!this.ports.has(Number(m[2]))) return true;
    return false;
  }
}

// ── Env ─────────────────────────────────────────────────────────────────────────────────────────

/** names that cross as they are (after path and URL mapping) */
const ENV_ALLOW = new Set([
  'LANG', 'LANGUAGE', 'TZ', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'CI',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'GOOGLE_API_KEY', 'GIT_TERMINAL_PROMPT',
]);
/** prefixes the runtime SDKs and the bus set (CLAUDE_CODE_ENTRYPOINT, CODEX_API_KEY, OPENAI_BASE_URL, NM_ORCH_*) */
const ENV_ALLOW_PREFIX = ['LC_', 'CLAUDE_', 'ANTHROPIC_', 'CODEX_', 'OPENAI_', 'GEMINI_', 'ANTIGRAVITY_', 'NM_ORCH_', 'MCP_', 'DEBUG_CLAUDE'];
/** set for the box whatever the host had: host paths and host identity mean nothing in there */
const ENV_FIXED_NAMES = new Set(['PATH', 'HOME', 'TERM', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME', 'PWD', 'HOSTNAME', 'TEMP', 'TMP', 'IS_SANDBOX']);
const PROXY_NAMES = /^(HTTPS?_PROXY|ALL_PROXY|https?_proxy|all_proxy)$/;
/** a value this long, or on several lines, rides a file too: the env words are logged like argv */
const ENV_INLINE_MAX = 1024;

export interface BoxEnv {
  env: Record<string, string>;
  secretEnv: Record<string, string>;
  /** names dropped, and why (logged, never the values) */
  dropped: string[];
}

export function boxRuntimeEnv(src: Readonly<Record<string, string | undefined>>, o: { paths: PathMap; urls: UrlRewrite; bearer?: string | null }): BoxEnv {
  const extra = new Set((src['NM_AGENT_ENV_PASSTHROUGH'] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const env: Record<string, string> = {
    PATH: BOX_PATH,
    HOME: BOX_HOME,
    TERM: 'dumb',
    LANG: 'C.UTF-8',
    TMPDIR: '/tmp',
    // the box runs as root, and Claude Code refuses to skip its prompts as root outside a sandbox
    IS_SANDBOX: '1',
  };
  const secretEnv: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [k, raw] of Object.entries(src)) {
    if (typeof raw !== 'string' || k === RELAY_TICKET_ENV || ENV_FIXED_NAMES.has(k) || k === 'NM_AGENT_ENV_PASSTHROUGH') continue;
    if (!isEnvName(k)) { dropped.push(`${k} (name)`); continue; }
    if (!(ENV_ALLOW.has(k) || extra.has(k) || ENV_ALLOW_PREFIX.some((p) => k.startsWith(p)))) continue;
    const v = o.paths.textToBox(o.urls.rewrite(raw));
    if (o.urls.unmapped(raw)) {
      // a proxy the box cannot reach would fail every request; better none (the box has egress)
      dropped.push(`${k} (${PROXY_NAMES.test(k) ? 'proxy' : 'url'} on loopback, not exposed to the box)`);
      continue;
    }
    if (isSecretEnvName(k) || looksLikeSecret(v) || v.length > ENV_INLINE_MAX || /[\n\r]/.test(v)) secretEnv[k] = v;
    else env[k] = v;
  }
  if (o.bearer) secretEnv[BOX_BEARER_ENV] = o.bearer;
  return { env, secretEnv, dropped };
}

// ── The spawner ─────────────────────────────────────────────────────────────────────────────────

/** what `BoxManager` gives the spawner (tests fake it) */
