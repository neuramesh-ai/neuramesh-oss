// THE FILM PROMPT (docs/design/video-rung-2026-09 §8, 2026-09-19). One builder for every lane that
// films a draft: the daemon's own-key rung, the platform's door, and the card that says what will
// be filmed. It lives in shared so the three cannot drift.
//
// WHY IT LOOKS LIKE THIS (George: "the text in the video is always muddled"; researched 2026-09-19
// against fal's Seedance 2.0 guide, ByteDance's own, and the troubleshooting guides in the plan):
//   1. A video model typesets like an image model: lettering is texture to it, and anything past a
//      couple of large words comes out as plausible glyphs that spell nothing. The reliable text is
//      the text the model never draws, so the film is a CLEAN PLATE by default, and the one case
//      that works (one short title, large, placed) is the one case the prompt asks for.
//   2. Long prompts drop instructions. The guides put the sweet spot at 30–100 words and name
//      "instruction dropout" past ~150: the model quietly ignores what it cannot reconcile. The old
//      prompt ran to 1,400 characters with the marketer's whole 2,000-character brief pasted in, so
//      "render no text" sat behind a brief that asked for burned-in captions and lost. This one is
//      a shot brief in fal's own order (subject, motion, look, camera, audio), the brief cut to its
//      first words with every caption ask stripped, and a hard cap.
//   3. Speech in double quotes is what the model lip-syncs; a prompt that says nothing about sound
//      comes back scored, so the audio line is explicit.
//   4. The film is the first N seconds of the script, not only its hook: a longer film takes the
//      beats that start inside it, sequenced as cuts, the way the guides write multi-shot prompts.
// Compression is the other half (bitrate_mode: high, same price) and lives in the registry.

import { trimEndChars, trimStartChars } from './linear';

/** one beat of a script: its window in seconds, the direction, the creator's line, the caption, and
 *  the PRODUCT SHOT it cuts to (`SHOW: <image>`, an image on the room's shelf, cut into the film as it is:
 *  video-rung plan §9) */
export interface FilmBeat { start: number; end: number; direction: string; spoken: string; caption: string; show: string }

// EVERY PATTERN HERE COSTS THE LINE ONCE (the public publish runs CodeQL, and its js/polynomial-redos
// named eight of the first draft's regexes): a value after a label starts right after the `:` and is
// trimmed, never `\s*` beside `(.*)`; a trailing run is cut by index (linear.ts); a quoted span stops
// at the next quote of any kind, so an opener that recurs cannot make the body backtrack.
const BLANKS = ' \t';
const STAMP_RE = /^\[(\d+):(\d\d)[ \t]*[-–][ \t]*(\d+):(\d\d)\](.*)$/;
const MAX_BEATS = 3;
const DIRECTION_WORDS = 14;
const SPOKEN_WORDS = 16;
const LOOK_WORDS = 22;
/** the prompt's ceiling in characters: past it the guides' "instruction dropout" begins */
export const FILM_PROMPT_MAX = 1_000;

const unquote = (s: string): string => trimEndChars(trimStartChars(s.trim(), '"“'), '"”').trim();
const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
/** the quoted span a line ends with (`… "the line."`), or the whole line when it is one: the creator's line */
function quotedTail(s: string): { line: string; before: string } | null {
  const t = trimEndChars(s, '.' + BLANKS);
  if (!t || !'"”'.includes(t[t.length - 1]!)) return null;
  const open = Math.max(t.lastIndexOf('"', t.length - 2), t.lastIndexOf('“', t.length - 2));
  if (open < 0) return null;
  const line = t.slice(open + 1, -1).trim();
  return line ? { line, before: t.slice(0, open) } : null;
}
/** the first `n` words, closed at a sentence end when one falls in the second half, else at a clause end there, else hard */
function cut(s: string, n: number): string {
  const w = words(s);
  if (w.length <= n) return s.trim();
  const head = w.slice(0, n);
  const lastAt = (re: RegExp): number => { for (let i = head.length - 1; i >= Math.floor(n / 2); i -= 1) if (re.test(head[i]!)) return i; return -1; };
  const stop = lastAt(/[.!?]$/);
  const clause = stop < 0 ? lastAt(/[,;:]$/) : -1;
  const end = stop >= 0 ? stop + 1 : clause >= 0 ? clause + 1 : head.length;
  return trimEndChars(head.slice(0, end).join(' '), ',;:' + BLANKS);
}

/** a direction as the shot brief wants it: no "cut to" of its own (the brief writes the cuts), no
 *  stray punctuation from the label that was stripped before it, no trailing colon */
const tidyDirection = (s: string): string => trimEndChars(trimStartChars(s, ',;:–-' + BLANKS).replace(/^(?:then )?(?:smash |jump )?cut (?:back )?to /i, ''), ',;:–-' + BLANKS).trim();
/** the text after `label:` on a line that starts with the label (blanks collapsed), or null */
function labelled(l: string, label: RegExp): string | null {
  const m = label.exec(l);
  return m ? l.slice(m[0].length).trim() : null;
}
const CAPTION_LABEL = /^(?:caption(?: on screen)?|(?:on-screen |on screen )?title|text on screen|on-screen text) ?:/i;
const SPOKEN_LABEL = /^spoken ?:/i;
const SHOW_LABEL = /^show ?:/i;
/** blanks collapsed to one space, so every label pattern can be written with single spaces and stay linear */
const oneSpaced = (s: string): string => s.replace(/[ \t]+/g, ' ').trim();

/** The timestamp line's remainder. A house model writes the whole beat ON that line
 *  (`[0:00-0:05] Hook: "Stop letting agents edit main." CAPTION: The chat loop is broken.`, live
 *  2026-09-19), so the caption and the spoken line are read off it by name, a quoted remainder is
 *  the creator's line, the `Hook:` label is dropped, and what is left is the direction. */
function stampLine(rest: string, beat: FilmBeat): void {
  let s = oneSpaced(rest);
  // the product shot, the caption and the spoken line by name, wherever they sit on the line (a word boundary, then the label)
  const show = /(?:^| )show ?:/i.exec(s);
  if (show) { beat.show = s.slice(show.index + show[0].length).trim(); s = s.slice(0, show.index); }
  // the caption by any of its names (CAPTION, TITLE, TEXT ON SCREEN: the live marketer wrote `TITLE: "Try NeuraMesh"`)
  const cap = /(?:^| )(?:caption(?: on screen)?|(?:on-screen |on screen )?title|text on screen|on-screen text) ?:/i.exec(s);
  if (cap) { beat.caption = unquote(s.slice(cap.index + cap[0].length)); s = s.slice(0, cap.index); }
  const spoken = /(?:^| )spoken ?:/i.exec(s);
  if (spoken) { beat.spoken = unquote(s.slice(spoken.index + spoken[0].length)); s = s.slice(0, spoken.index); }
  s = trimStartChars(s.replace(/^(?:the )?hook ?[:—–,-]?/i, ''), BLANKS);
  // a quoted remainder is the creator's line; so is a quoted TAIL after a direction
  // (`Hook, straight to camera: "I expected a catch."`, live 2026-09-20)
  const quoted = quotedTail(s);
  if (quoted) { if (!beat.spoken) beat.spoken = quoted.line; s = quoted.before; }
  beat.direction = tidyDirection(trimEndChars(s, '.' + BLANKS));
}

function readLine(raw: string, beat: FilmBeat): void {
  const l = oneSpaced(raw);
  const spoken = labelled(l, SPOKEN_LABEL);
  if (spoken !== null) { beat.spoken = unquote(spoken); return; }
  // a bare quoted line is a spoken line too (a script written as the creator's lines, no labels)
  const quoted = '"“'.includes(l[0] ?? '') ? quotedTail(l) : null;
  if (quoted && !quoted.before) { if (!beat.spoken) beat.spoken = quoted.line; return; }
  const cap = labelled(l, CAPTION_LABEL);
  if (cap !== null) { beat.caption = unquote(cap); return; }
  const show = labelled(l, SHOW_LABEL);
  if (show !== null) { beat.show = show; return; }
  if (!beat.direction) beat.direction = tidyDirection(trimEndChars(l, '.' + BLANKS));
}

const newBeat = (start: number, end: number): FilmBeat => ({ start, end, direction: '', spoken: '', caption: '', show: '' });

/** The script as beats: one per `[m:ss-m:ss]` block with its start second, `Spoken:` and
 *  `CAPTION:` read by name. A body without timestamps is one beat at 0: its first three lines. */
export function scriptBeats(body: string): FilmBeat[] {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const beats: FilmBeat[] = [];
  let cur: FilmBeat | null = null;
  for (const l of lines) {
    const m = STAMP_RE.exec(l);
    if (m) {
      cur = newBeat(Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4]));
      beats.push(cur);
      stampLine(m[5]!, cur);
    } else if (cur) readLine(l, cur);
  }
  if (beats.length) return beats;
  const one = newBeat(0, 0);
  for (const l of lines.slice(0, 3)) readLine(l, one);
  return [one];
}

/** THE PRODUCT SHOTS (plan §9): the beats that cut to a real image, in order, each a window in seconds
 *  and the shelf image's name. A window that ends before it starts is read as the next beat's start. */
export function productShots(body: string): Array<{ start: number; end: number; show: string }> {
  const beats = scriptBeats(body);
  return beats.flatMap((b, i) => {
    if (!b.show) return [];
    const end = b.end > b.start ? b.end : (beats[i + 1]?.start ?? b.start + 3);
    return [{ start: b.start, end, show: b.show }];
  });
}

const PRODUCT_WORDS_RE = /\b(app|screen|phone|product|interface|dashboard|recording|ui|home screen|the board|laptop screen)\b/i;
/** a beat that shows the product on screen, by its words: the gate that asks for a SHOW line reads this */
export const looksLikeProductBeat = (b: FilmBeat): boolean => PRODUCT_WORDS_RE.test(b.direction);

/** the first beat, for the callers that want the hook alone */
export const firstBeat = (body: string): FilmBeat => scriptBeats(body)[0]!;

/** the beats a film of `seconds` shows: those that start with two seconds still to play, at most three */
export function beatsWithin(body: string, seconds: number): FilmBeat[] {
  const all = scriptBeats(body);
  const inside = all.filter((b, i) => i === 0 || b.start <= seconds - 2);
  return inside.slice(0, MAX_BEATS);
}

/** the one lettering a video model can be trusted with: a title of at most three short words.
 *  Anything longer is not asked for, because it would come back misspelled. */
export function lettering(caption: string): string | null {
  const c = trimEndChars(caption, '.!').trim();
  return c && words(c).length <= 3 && c.length <= 20 ? c : null;
}

const CAPTION_ASK_RE = /\b(captions?|subtitles?|on-screen text|text overlays?|overlay text|text on screen|lettering|title cards?|lower thirds?|watermarks?|logos?|headlines?|burned[- ]in|the words)\b/i;
/** the brief's visual half, in a few words: quoted text goes (a brief quotes what it wants
 *  lettered), then every sentence that asks for lettering, because the text rule below must not
 *  lose to a brief that wants burned-in captions (found live). The rest is cut to a look. */
export function lookFrom(brief: string): string {
  // a quoted span stops at the next quote of ANY kind: an opener that recurs never re-opens the body
  const plain = brief.replace(/["“][^"“”]*["”]/g, ' ').replace(/\s+/g, ' ');
  const kept = (plain.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter((s) => /\w/.test(s) && !CAPTION_ASK_RE.test(s));
  return trimEndChars(cut(kept.join(' '), LOOK_WORDS), '.:');
}

/** how long a film of `seconds` takes to land, in minutes, as the card says it */
export const filmMinutes = (seconds: number): number => Math.max(2, Math.ceil(seconds / 4));

/**
 * The prompt a draft is filmed from: a vertical creator clip of the script's first `seconds`,
 * the spoken lines in quotes, one text rule, the look, the audio. Under FILM_PROMPT_MAX.
 */
export function filmPrompt(body: string, brief: string, seconds = 8): string {
  const beats = beatsWithin(body, seconds);
  const shots = beats.map((b, i) => {
    const dir = cut(b.direction, DIRECTION_WORDS);
    const say = cut(b.spoken, SPOKEN_WORDS);
    const shot = dir ? (i === 0 ? `Open on ${dir}.` : `Then cut to ${dir}.`) : (i === 0 ? '' : 'Then cut.');
    const line = say ? (i === 0 ? `The creator says to camera, casual: "${say}"` : `"${say}"`) : '';
    return [shot, line].filter(Boolean).join(' ');
  }).filter(Boolean);
  const title = lettering(beats[0]?.caption ?? '');
  const look = lookFrom(brief);
  const assemble = (cuts: string[], withLook: boolean): string => [
    `Vertical 9:16 phone video, ${seconds} seconds, handheld, natural light, a creator talking to camera, raw and real.`,
    ...cuts,
    title ? `One on-screen title, large and centered in the lower third, exactly: "${title}". No other text.` : 'No on-screen text, no subtitles, no captions, no logos.',
    withLook && look ? `Look: ${look}.` : '',
    "Audio: the creator's voice and room tone, no music.",
  ].filter(Boolean).join(' ');
  // over the cap: the look goes first, then the last cut, never the text rule
  let out = assemble(shots, true);
  if (out.length > FILM_PROMPT_MAX) out = assemble(shots, false);
  for (let n = shots.length - 1; out.length > FILM_PROMPT_MAX && n >= 1; n -= 1) out = assemble(shots.slice(0, n), false);
  return out.slice(0, FILM_PROMPT_MAX);
}
