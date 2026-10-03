// the browser lane's wire (models-and-replies round, board C3): the cloud machine's own Chromium,
// drawn in the web client's side panel. a site that refuses frames (x.com, google.com) still shows,
// because the page runs on the member's machine and only its pixels travel.
//
// one JSON object per relay data frame, both ways: base64 of one UTF-8 line, the shape the
// engineering and stream lanes carry. a frame message is never split across data frames. the
// machine keeps each one under the relay's data cap (MAX_CHANNEL_DATA_B64_CHARS in
// packages/relay) by lowering the JPEG quality, then the size, so a reader never joins halves.
//
// pure: no sockets, no Buffer. the machine edge and the web client both import it.

/** the relay lane name (packages/relay ChannelLane) */
export const BROWSER_LANE = 'browser' as const;

/** `person`: the member's own browser, signed in, persistent on their machine. `agent`: the browser
 *  the agents drive, with no cookies from the person. the panel can steer only the person's tab. */
export type BrowserTab = 'person' | 'agent';

/** the open meta a viewer sends: which tab, and the pane's size in CSS pixels */
export interface BrowserOpenMeta { v: 1; tab: BrowserTab; width: number; height: number }

/** the page viewport a pane may ask for, clamped on the machine */
export const BROWSER_VIEWPORT = { minW: 320, minH: 240, maxW: 1920, maxH: 1440 } as const;
export const MAX_BROWSER_URL_CHARS = 2048;
export const MAX_BROWSER_TEXT_CHARS = 2000;
const MAX_COORD = 10_000;

/** CDP's modifier bits: alt 1, ctrl 2, meta 4, shift 8 */
export type BrowserMods = number;

/** browser → machine */
export type BrowserInput =
  | { t: 'navigate'; url: string }
  | { t: 'back' } | { t: 'forward' } | { t: 'reload' }
  | { t: 'mouse'; type: 'down' | 'up' | 'move'; x: number; y: number; button?: 'left' | 'middle' | 'right'; clicks?: number; mods?: BrowserMods }
  | { t: 'wheel'; x: number; y: number; dx: number; dy: number; mods?: BrowserMods }
  | { t: 'key'; type: 'down' | 'up'; key: string; code: string; keyCode: number; mods?: BrowserMods }
  | { t: 'text'; text: string }
  | { t: 'resize'; width: number; height: number }
  | { t: 'tab'; tab: BrowserTab }
  /** the viewer drew frame `n`: the machine may send the next one (BROWSER_FRAME_WINDOW) */
  | { t: 'ack'; n: number };

/** machine → browser */
export type BrowserOutput =
  /** one screencast frame: a JPEG, base64, of a `w` × `h` page viewport */
  | { t: 'frame'; n: number; w: number; h: number; jpeg: string }
  /** the tab's page. `agent` names the agent that drove it last, `idle` means no agent page is open */
  | { t: 'state'; tab: BrowserTab; url: string; title: string; canBack: boolean; canForward: boolean; loading: boolean; agent?: string; idle?: boolean }
  /** a sentence the pane shows: a refused address, a site that failed, a busy machine */
  | { t: 'notice'; text: string };

/** a viewer may hold this many frames it has not acknowledged. past it the machine keeps only the
 *  newest frame, so a slow link sees a later picture, never a queue of old ones */
export const BROWSER_FRAME_WINDOW = 2;
/** the JPEG quality a machine starts at and the steps it walks down when a frame does not fit */
export const BROWSER_QUALITY_STEPS = [60, 45, 30, 20] as const;

/** the base64 length of `bytes` bytes: what a line costs inside a relay data frame */
export const b64Length = (bytes: number): number => 4 * Math.ceil(bytes / 3);

const isTab = (v: unknown): v is BrowserTab => v === 'person' || v === 'agent';
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;
const side = (v: unknown, lo: number, hi: number): number | null => (num(v, 0, 100_000) ? Math.min(hi, Math.max(lo, Math.round(v))) : null);
const optional = <T>(v: unknown, ok: (x: unknown) => x is T): v is T | undefined => v === undefined || ok(v);
const mods = (v: unknown): v is BrowserMods | undefined => optional(v, (x): x is number => int(x, 0, 15));

/** the clamped viewport for a requested size, or null when the request is not a size */
export function browserViewport(width: unknown, height: unknown): { width: number; height: number } | null {
  const w = side(width, BROWSER_VIEWPORT.minW, BROWSER_VIEWPORT.maxW);
  const h = side(height, BROWSER_VIEWPORT.minH, BROWSER_VIEWPORT.maxH);
  return w && h ? { width: w, height: h } : null;
}

/** an open's meta, validated and clamped, or null for a meta this wire does not speak */
export function browserOpenMeta(m: unknown): BrowserOpenMeta | null {
  if (typeof m !== 'object' || m === null) return null;
  const r = m as Record<string, unknown>;
  if (r['v'] !== 1 || !isTab(r['tab'])) return null;
  const size = browserViewport(r['width'], r['height']);
  return size ? { v: 1, tab: r['tab'], ...size } : null;
}

type Fields = Record<string, unknown>;
const point = (m: Fields): boolean => num(m['x'], 0, MAX_COORD) && num(m['y'], 0, MAX_COORD) && mods(m['mods']);
const withMods = (m: Fields): { mods?: number } => (m['mods'] ? { mods: m['mods'] as number } : {});
const isButton = (b: unknown): b is 'left' => b === 'left' || b === 'middle' || b === 'right';
const isClicks = (c: unknown): c is number => int(c, 1, 3);

// one reader per message type, each small enough to read at a glance
const READERS: Record<string, (m: Fields) => BrowserInput | null> = {
  navigate: (m) => (str(m['url'], 1, MAX_BROWSER_URL_CHARS) ? { t: 'navigate', url: m['url'] } : null),
  back: () => ({ t: 'back' }),
  forward: () => ({ t: 'forward' }),
  reload: () => ({ t: 'reload' }),
  mouse: (m) => {
    const type = m['type'];
    if ((type !== 'down' && type !== 'up' && type !== 'move') || !point(m) || !optional(m['button'], isButton) || !optional(m['clicks'], isClicks)) return null;
    return { t: 'mouse', type, x: m['x'] as number, y: m['y'] as number, ...(m['button'] ? { button: m['button'] as 'left' } : {}), ...(m['clicks'] ? { clicks: m['clicks'] as number } : {}), ...withMods(m) };
  },
  wheel: (m) => (point(m) && num(m['dx'], -MAX_COORD, MAX_COORD) && num(m['dy'], -MAX_COORD, MAX_COORD)
    ? { t: 'wheel', x: m['x'] as number, y: m['y'] as number, dx: m['dx'] as number, dy: m['dy'] as number, ...withMods(m) } : null),
  key: (m) => {
    const type = m['type'];
    if ((type !== 'down' && type !== 'up') || !str(m['key'], 1, 32) || !str(m['code'], 0, 32) || !int(m['keyCode'], 0, 255) || !mods(m['mods'])) return null;
    return { t: 'key', type, key: m['key'], code: m['code'], keyCode: m['keyCode'], ...withMods(m) };
  },
  text: (m) => (str(m['text'], 1, MAX_BROWSER_TEXT_CHARS) ? { t: 'text', text: m['text'] } : null),
  resize: (m) => { const size = browserViewport(m['width'], m['height']); return size ? { t: 'resize', ...size } : null; },
  tab: (m) => (isTab(m['tab']) ? { t: 'tab', tab: m['tab'] } : null),
  ack: (m) => (int(m['n'], 0, Number.MAX_SAFE_INTEGER) ? { t: 'ack', n: m['n'] } : null),
};

/** one viewer message, validated field by field, or null. a field outside its bounds drops the
 *  whole message: the machine never guesses at what a malformed input meant */
export function parseBrowserInput(v: unknown): BrowserInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const m = v as Fields;
  const read = typeof m['t'] === 'string' && Object.hasOwn(READERS, m['t']) ? READERS[m['t']] : undefined;
  return read ? read(m) : null;
}

/** what the agent tab takes from the panel: a tab switch and frame acks, nothing that steers it */
export const agentTabAllows = (m: BrowserInput): boolean => m.t === 'tab' || m.t === 'ack';
