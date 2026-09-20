// The film prompt (filmprompt.ts): the script as beats, the beats a length shows, the one text
// rule, the brief cut to a look, and the cap. The old prompt's traps are pinned here: the caption
// handed to the model beside "no text", a brief that asks for burned-in captions, 1,400 characters.
import { describe, expect, it } from 'vitest';
import { FILM_PROMPT_MAX, beatsWithin, filmMinutes, filmPrompt, firstBeat, lettering, lookFrom, scriptBeats } from '../src/filmprompt';

const SCRIPT = `[0:00-0:03] HOOK — handheld, walking, no laptop bag
Spoken: "My laptop's in my bag. My code isn't waiting for me."
CAPTION ON SCREEN: no laptop, still shipping

[0:03-0:15] Open the app to Home.
Spoken: "This is Home."
CAPTION: queue + sessions, synced

[0:15-0:30] Scroll the session list, tap one.
Spoken: "Every session, one list. I pick up where the agent left off."

[0:30-0:40] Close on the accept button.
Spoken: "Merge it. Done."`;

describe('the script as beats', () => {
  it('reads every timestamped block with its start, the spoken line and the caption by name', () => {
    expect(scriptBeats(SCRIPT).map((b) => [b.start, b.direction, b.spoken, b.caption])).toEqual([
      [0, 'handheld, walking, no laptop bag', "My laptop's in my bag. My code isn't waiting for me.", 'no laptop, still shipping'],
      [3, 'Open the app to Home', 'This is Home.', 'queue + sessions, synced'],
      [15, 'Scroll the session list, tap one', 'Every session, one list. I pick up where the agent left off.', ''],
      [30, 'Close on the accept button', 'Merge it. Done.', ''],
    ]);
    expect(firstBeat(SCRIPT)).toMatchObject({ direction: 'handheld, walking, no laptop bag', caption: 'no laptop, still shipping' });
  });
  it('a body without timestamps is one beat: its first lines; bare quoted lines are spoken', () => {
    expect(firstBeat('Meet the shared inbox.\nSpoken: "One thread per customer."')).toEqual({ start: 0, direction: 'Meet the shared inbox', spoken: 'One thread per customer.', caption: '' });
    expect(firstBeat('"I started a coding session from my couch."\n"This is Home."')).toMatchObject({ direction: '', spoken: 'I started a coding session from my couch.' });
  });
  it('a beat written on the timestamp line (the house model, live 2026-09-19) still yields its parts', () => {
    expect(firstBeat('[0:00-0:05] Hook: "Stop letting AI agents edit your codebase without a plan." CAPTION: From messy chat logs to structured agent workflows.\n[0:05-0:20] Problem: contrast.'))
      .toMatchObject({ direction: '', spoken: 'Stop letting AI agents edit your codebase without a plan.', caption: 'From messy chat logs to structured agent workflows.' });
    expect(firstBeat('[0:00-0:05] Hook: Show a messy desktop with overlapping AI chat logs. CAPTION: The agent chat loop is broken.\n[0:05-0:20] Problem: chaos.'))
      .toMatchObject({ direction: 'Show a messy desktop with overlapping AI chat logs', spoken: '', caption: 'The agent chat loop is broken.' });
    expect(firstBeat('[0:00-0:03] Creator points at camera. Spoken: "Three things we learned."')).toMatchObject({ direction: 'Creator points at camera', spoken: 'Three things we learned.' });
  });
  it('a beat as the live marketer wrote it (2026-09-20): a label with a comma, a quoted tail, a "Cut to" of its own', () => {
    const live = `[0:00-0:03] Hook, straight to camera: "I expected a catch. There wasn't one."
[0:03-0:07] Cut to screen recording of the app home screen. Spoken: "Surprise one: free forever on Mac."
[0:07-0:11] Cut back to creator, casual tone. Spoken: "Surprise two: my code never leaves my machine."`;
    expect(scriptBeats(live).map((b) => [b.direction, b.spoken])).toEqual([
      ['straight to camera', "I expected a catch. There wasn't one."],
      ['screen recording of the app home screen', 'Surprise one: free forever on Mac.'],
      ['creator, casual tone', 'Surprise two: my code never leaves my machine.'],
    ]);
    const p = filmPrompt(live, '', 15);
    expect(p).toMatch(/Open on straight to camera\. The creator says to camera, casual: "I expected a catch\. There wasn't one\." Then cut to screen recording of the app home screen\. "Surprise one: free forever on Mac\." Then cut to creator, casual tone\./);
    expect(p).not.toMatch(/Open on ,|cut to Cut/);
  });
  it('a film shows the beats that start inside it, three at most', () => {
    expect(beatsWithin(SCRIPT, 5).map((b) => b.start)).toEqual([0, 3]);
    expect(beatsWithin(SCRIPT, 8).map((b) => b.start)).toEqual([0, 3]);
    expect(beatsWithin(SCRIPT, 15).map((b) => b.start)).toEqual([0, 3]);
    expect(beatsWithin(SCRIPT, 30).map((b) => b.start)).toEqual([0, 3, 15]); // the 0:30 beat has no time left; the cap holds at three
    expect(beatsWithin('[0:00-0:05] one\n[0:20-0:30] two', 8).map((b) => b.start)).toEqual([0]);
  });
});

describe('the text rule', () => {
  it('trusts the model with one short title only', () => {
    expect(lettering('NO MERGE HELL.')).toBe('NO MERGE HELL');
    expect(lettering('still shipping')).toBe('still shipping');
    expect(lettering('no laptop, still shipping')).toBe(null);
    expect(lettering('The agent chat loop is broken.')).toBe(null);
    expect(lettering('')).toBe(null);
  });
  it('drops every sentence of the brief that asks for lettering, and cuts the rest to a look', () => {
    expect(lookFrom('Split-screen video. Left side: messy terminal windows. Bold caption at the top reads WORKFLOW. Natural desk lighting, shot on 35mm.')).toBe('Split-screen video. Left side: messy terminal windows. Natural desk lighting, shot on 35mm');
    expect(lookFrom('Text overlay: "1. The animation when you long-press". Subtitles burned in.')).toBe('');
    const long = lookFrom(Array.from({ length: 40 }, (_, i) => `word${i}`).join(' '));
    expect(long.split(' ')).toHaveLength(22);
    // a long brief closes at a clause end in its second half rather than mid-phrase ("then a clean", live)
    expect(lookFrom('Vertical 9:16 selfie-style shot, a developer at a desk talking to camera in a casual home office, natural light, then a clean screen recording insert of the NeuraMesh desktop app home screen, on-brand technical but warm mood.')).toBe('Vertical 9:16 selfie-style shot, a developer at a desk talking to camera in a casual home office, natural light');
  });
});

describe('the prompt', () => {
  it('is a shot brief of the first seconds: the length, the cuts, the quoted lines, one text rule, the look, the audio, under the cap', () => {
    const p = filmPrompt(SCRIPT, '9:16 vertical. Real screen recording cut with handheld shots.', 8);
    expect(p).toMatch(/^Vertical 9:16 phone video, 8 seconds, handheld/);
    expect(p).toMatch(/Open on handheld, walking, no laptop bag\. The creator says to camera, casual: "My laptop's in my bag\. My code isn't waiting for me\."/);
    expect(p).toMatch(/Then cut to Open the app to Home\. "This is Home\."/);
    expect(p).not.toMatch(/Scroll the session list/); // starts at 0:15, outside an 8 s film
    expect(p).toMatch(/No on-screen text, no subtitles, no captions, no logos\./); // the caption is four words: not asked for
    expect(p).not.toMatch(/still shipping|CAPTION/);
    expect(p).toMatch(/Look: 9:16 vertical\. Real screen recording cut with handheld shots\./);
    expect(p).toMatch(/Audio: the creator's voice and room tone, no music\.$/);
    expect(p.length).toBeLessThanOrEqual(FILM_PROMPT_MAX);
    expect(p.split(/\s+/).length).toBeLessThan(120);
  });
  it('a longer film takes more of the script', () => {
    const p = filmPrompt(SCRIPT, '', 30);
    expect(p).toMatch(/30 seconds/);
    expect(p).toMatch(/Then cut to Scroll the session list, tap one\. "Every session, one list\. I pick up where the agent left off\."/);
    expect(p).not.toMatch(/Look:/);
  });
  it('asks for a short caption as one placed title, exactly, and never a long one', () => {
    const p = filmPrompt('[0:00-0:05] Hook: Show a messy desktop. CAPTION: NO MERGE HELL.', 'Split screen.');
    expect(p).toMatch(/One on-screen title, large and centered in the lower third, exactly: "NO MERGE HELL"\. No other text\./);
    const q = filmPrompt('[0:00-0:05] Hook: Show a messy desktop with overlapping AI chat logs. CAPTION: The agent chat loop is broken.', 'Split screen.');
    expect(q).toMatch(/Open on Show a messy desktop with overlapping AI chat logs\. No on-screen text/);
    expect(q).not.toMatch(/chat loop is broken|: :/);
  });
  it('a brief that asks for burned-in captions cannot smuggle them past the text rule', () => {
    const p = filmPrompt(SCRIPT, 'Bold captions burned in at the top: "1. The animation when you long-press". Dark desk, warm lamp.', 8);
    expect(p).not.toMatch(/burned in|long-press/);
    expect(p).toMatch(/Look: Dark desk, warm lamp\./);
  });
  it('holds the cap by dropping the look, then the last cut, never the text rule', () => {
    const wordy = Array.from({ length: 4 }, (_, i) => `[0:${String(i * 4).padStart(2, '0')}-0:${String(i * 4 + 4).padStart(2, '0')}] ${Array.from({ length: 14 }, (_, k) => `direction${i}${k}`).join(' ')}\nSpoken: "${Array.from({ length: 16 }, (_, k) => `word${i}${k}longer`).join(' ')}"`).join('\n');
    const p = filmPrompt(wordy, Array.from({ length: 22 }, (_, k) => `look${k}`).join(' '), 15);
    expect(p.length).toBeLessThanOrEqual(FILM_PROMPT_MAX);
    expect(p).toMatch(/No on-screen text/);
    expect(p).toMatch(/Audio:/);
  });
  it('every parser costs a flooded script once (the public publish runs CodeQL; 20k repeats under 200 ms)', () => {
    const blanks = ' \t'.repeat(10_000);
    const floods = [
      `[0:00-0:03]${blanks}Hook${blanks}: "${'a '.repeat(10_000)}`,
      `Spoken:${blanks}${'"'.repeat(10_000)}`,
      `CAPTION ON SCREEN${blanks}:${blanks}x`,
      `${'"'.repeat(10_000)}${' '.repeat(10_000)}`,
      `Cut to ${'x,'.repeat(10_000)}${' ,;:'.repeat(5_000)}`,
      `${'“'.repeat(10_000)} a look ${'.'.repeat(10_000)}`,
      `${'caption '.repeat(5_000)}${'x'.repeat(10_000)}!!!!${' '.repeat(10_000)}`,
    ];
    const t0 = Date.now();
    for (const f of floods) { scriptBeats(f); scriptBeats(`[0:00-0:03] ${f}\n${f}`); lookFrom(f); lettering(f); filmPrompt(f, f, 15); }
    expect(Date.now() - t0).toBeLessThan(200);
  });
  it('the wait the card promises grows with the length', () => {
    expect([5, 8, 15, 30].map(filmMinutes)).toEqual([2, 2, 4, 8]);
  });
});
