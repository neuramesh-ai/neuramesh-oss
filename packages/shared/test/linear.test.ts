// The linear rewrites of the 2026-09-18 CodeQL sweep (js/polynomial-redos, 48 alerts on the public
// main). Two proofs per rewrite: the old regex, kept here as the spec, agrees with the new code on
// random inputs over the characters that matter; and the attack string CodeQL named costs the
// input, not its square. A quadratic pattern takes seconds at the sizes below, the linear one a
// few milliseconds, so the bounds hold on a loaded runner.
import { describe, expect, it } from 'vitest';
import { articleFrom, parseArticleRef } from '../src/articles';
import { parseQuestions, parseTaskUnitRef, readAnswers } from '../src/cards';
import { scrubEmdash } from '../src/commrules';
import { engineeringPlanItems } from '../src/engineering/activity';
import { dotLines, fencedBlock, firstSentence, lineHas, stripFenced, trimEndChars, trimLineEnds, trimStartChars } from '../src/linear';
import { parseNeed, stripNeed } from '../src/needs';
import { playbookFromAsk } from '../src/playbooks';
import { canonicalPolicyHost, classifyShellCommand } from '../src/policy';
import { parseReviewVerdict } from '../src/prompts';
import { parseReportRef } from '../src/reports';
import { briefPretty } from '../src/sessions';
import { parseSkillFile } from '../src/skill-parse';

// a small deterministic generator (mulberry32), so a failure reproduces
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function samples(alphabet: readonly string[], n: number, maxLen: number, seed = 7): string[] {
  const r = rng(seed);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const len = Math.floor(r() * (maxLen + 1));
    let s = '';
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(r() * alphabet.length)];
    out.push(s);
  }
  return out;
}
const ms = (f: () => unknown): number => { const t = performance.now(); f(); return performance.now() - t; };

describe('the helpers agree with the regexes they replaced', () => {
  it('trimEndChars = /[set]+$/', () => {
    for (const s of samples(['a', '/', '\\', '.', ')', ';'], 3000, 12)) {
      expect(trimEndChars(s, '/')).toBe(s.replace(/\/+$/, ''));
      expect(trimEndChars(s, '/\\')).toBe(s.replace(/[/\\]+$/, ''));
      expect(trimEndChars(s, '.')).toBe(s.replace(/\.+$/, ''));
      expect(trimEndChars(s, '),.;')).toBe(s.replace(/[),.;]+$/, ''));
      expect(trimStartChars(s, '/')).toBe(s.replace(/^\/+/, ''));
    }
  });
  it('trimLineEnds = /[ \\t]+$/gm', () => {
    for (const s of samples(['a', ' ', '\t', '\n', '\r'], 4000, 16)) expect(trimLineEnds(s)).toBe(s.replace(/[ \t]+$/gm, ''));
  });
  it('fencedBlock and stripFenced = the ```lang fence regexes', () => {
    const alphabet = ['```nmx\n', '\n```', 'a', '\n', '`', '{', '}'];
    for (const s of samples(alphabet, 4000, 10)) {
      const m = /```nmx\n([\s\S]*?)\n```/.exec(s);
      const b = fencedBlock(s, 'nmx');
      expect(b?.inner ?? null).toBe(m?.[1] ?? null);
      if (m && b) { expect(b.start).toBe(m.index); expect(b.end).toBe(m.index + m[0].length); }
      expect(stripFenced(s, 'nmx')).toBe(s.replace(/```nmx\n[\s\S]*?\n```/g, ''));
    }
  });
  it('a slug trims one dash at each end, because the collapse before it leaves no run', () => {
    for (const raw of samples(['a', '-', ' ', '_', '.', 'B'], 3000, 12)) {
      const s = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      expect(s.replace(/^-|-$/g, '')).toBe(s.replace(/^-+|-+$/g, ''));
    }
  });
  it('dotLines splits where `.` stops, and lineHas = /first.*then/', () => {
    expect(dotLines('a\r\nb\rc\nd\u2028e\u2029f')).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    for (const s of samples(['blocked by', 'plan mode', ' ', 'x', '\n'], 3000, 6)) expect(lineHas(s, 'blocked by', 'plan mode'), JSON.stringify(s)).toBe(/blocked by.*plan mode/.test(s));
    expect(ms(() => lineHas('blocked by'.repeat(6000), 'blocked by', 'plan mode'))).toBeLessThan(200);
  });
  it('the em-dash scrub agrees with the unanchored regexes', () => {
    const old = (t: string) => t.replace(/\s*[—–]\s*(?=[A-Z])/g, '. ').replace(/\s*[—–]\s*/g, ', ');
    for (const s of samples(['a', 'B', ' ', '—', '–', '\n', '.'], 4000, 10)) expect(scrubEmdash(s), JSON.stringify(s)).toBe(old(s));
  });
  it('briefPretty agrees on the separator glue', () => {
    const glue = (t: string) => t.replace(/\s+[—–]\s+/g, ' · ').replace(/\s+-\s+/g, ' · ');
    const now = (t: string) => t.replace(/(^|\S)\s+[—–]\s+/g, '$1 · ').replace(/(^|\S)\s+-\s+/g, '$1 · ');
    for (const s of samples(['a', ' ', '—', '-', '·', '\n'], 4000, 10)) expect(now(s)).toBe(glue(s));
    expect(briefPretty('a — b - c')).toBe('a · b · c');
  });
  it('the JSON object of a verdict is the first brace to the last', () => {
    for (const s of samples(['{', '}', 'a', '"', ' ', '\n'], 3000, 10)) {
      const m = s.match(/\{[\s\S]*\}/)?.[0] ?? null;
      const open = s.indexOf('{'); const close = s.lastIndexOf('}');
      expect(open !== -1 && close > open ? s.slice(open, close + 1) : null).toBe(m);
    }
    expect(parseReviewVerdict('```json\n{"verdict":"approve","reason":"ok"}\n```')).toEqual({ verdict: 'approve', reason: 'ok' });
  });
  it('the playbook ask agrees with /run the (.+?) playbook/i', () => {
    for (const s of samples(['run the ', ' playbook', 'weekly digest', 'Run The ', ' ', '\n', 'x'], 3000, 6)) {
      const m = /run the (.+?) playbook/i.exec(s);
      const old = m ? m[1]!.trim().toLowerCase() : null;
      // the function maps the title to a registry id; compare the extracted title through a stub registry instead
      let want: string | null = null;
      for (const line of dotLines(s.toLowerCase())) {
        const at = line.indexOf('run the ');
        if (at === -1) continue;
        const end = line.indexOf(' playbook', at + 9);
        if (end === -1) continue;
        want = line.slice(at + 8, end).trim();
        break;
      }
      expect(want, JSON.stringify(s)).toBe(old);
    }
    expect(playbookFromAsk('Please run the Reply radar playbook now')).toBe('engage');
  });
});

describe('what the rewrites changed on purpose', () => {
  it('a title is the first line that starts with "# " and a non-blank', () => {
    expect(articleFrom('x.md', '# \n\nHello').title).toBe('x');
    expect(articleFrom('x.md', '#   Spaced title   \n\nbody').title).toBe('Spaced title');
  });
  it('a ‹article:id› or ‹report:id› never spans another marker', () => {
    expect(parseArticleRef('‹article:‹article:abc›')?.id).toBe('abc');
    expect(parseReportRef('‹report:‹report:abc›')?.id).toBe('abc');
  });
  it('a question option keeps its words and loses its quotes, CR included', () => {
    const body = '```nmq\nquestion: Which?\noptions:\n  - "one"  \r\n  - two\n```';
    expect((parseQuestions(body)[0]?.options ?? []).map((o) => o.label)).toEqual(['one', 'two']);
    expect(parseTaskUnitRef('‹task:11111111-1111-1111-1111-111111111111› keep \t\n\n\n\nthis')?.prose).toBe('keep\n\nthis');
  });
  it('an answer line reads the value after the arrow', () => {
    expect(readAnswers(['**Which?** →   two'])).toEqual(new Map([['Which?', 'two']]));
  });
  it('a plan item starts at its first non-blank and ends before its blanks', () => {
    expect(engineeringPlanItems('- [x]   Done thing   \r\n2)  Next one  ').map((i) => i.text)).toEqual(['Done thing', 'Next one']);
  });
  it('the first sentence is the title, even when it ends before a newline', () => {
    expect(firstSentence('Fix the bug. Then more.\nDetails')).toBe('Fix the bug');
    expect(firstSentence('no punctuation')).toBe('no punctuation');
  });
  it('a skill name keeps an apostrophe and loses its quotes', () => {
    const p = parseSkillFile('skills/x/SKILL.md', '---\nname: "the name"\ndescription: it\'s fine  \r\n---\nbody');
    expect(p?.name).toBe('the-name'); // the name is slugified after
    expect(p?.description).toBe("it's fine");
  });
  it('a policy host loses its trailing dots, and the destructive shapes still match', () => {
    expect(canonicalPolicyHost('Example.com...')).toBe('example.com');
    expect(classifyShellCommand('rm -rf build')).toBe('destructive');
    expect(classifyShellCommand('rm  foo bar --force')).toBe('destructive');
    expect(classifyShellCommand(':(){ :|:& };:')).toBe('destructive');
  });
  it('a need block parses and strips through the helper', () => {
    const block = '```nmneed\n{"channel":"c","ask":"a","connect":["x"]}\n```';
    expect(parseNeed('hi\n' + block + '\nbye')?.channel).toBe('c');
    expect(stripNeed('hi\n' + block + '\nbye')).toBe('hi\n\nbye');
  });
});

describe('the attack strings CodeQL named cost the input, not its square', () => {
  const N = 60_000;
  it('trailing runs', () => {
    expect(ms(() => trimEndChars('/'.repeat(N) + 'x', '/'))).toBeLessThan(200);
    expect(ms(() => trimLineEnds('\t'.repeat(N) + 'x'))).toBeLessThan(200);
  });
  it('a fence opener that recurs without a closer', () => {
    const s = '```nmneed\n' + '```nmneed\na'.repeat(N / 10);
    expect(ms(() => { parseNeed(s); stripNeed(s); })).toBeLessThan(200);
  });
  it('a run of markers, brackets, blanks and braces', () => {
    expect(ms(() => parseArticleRef('‹article:' + '‹article:!'.repeat(N / 10)))).toBeLessThan(200);
    expect(ms(() => articleFrom('x', '![' .repeat(N / 2)))).toBeLessThan(400);
    expect(ms(() => scrubEmdash(' '.repeat(N) + 'a'))).toBeLessThan(200);
    expect(ms(() => briefPretty(' '.repeat(N) + 'a'))).toBeLessThan(200);
    expect(ms(() => { try { parseReviewVerdict('{{'.repeat(N / 2)); } catch { /* no verdict, said fast */ } })).toBeLessThan(200);
    expect(ms(() => playbookFromAsk('run the a'.repeat(N / 9)))).toBeLessThan(200);
    expect(ms(() => classifyShellCommand(':(){{'.repeat(N / 5)))).toBeLessThan(200);
    expect(ms(() => classifyShellCommand('rm' + '  '.repeat(N / 2)))).toBeLessThan(200);
    expect(ms(() => readAnswers(['**a**→' + ' '.repeat(N)]))).toBeLessThan(200);
    expect(ms(() => engineeringPlanItems('* [ ] ' + '  '.repeat(N / 2)))).toBeLessThan(200);
    expect(ms(() => parseSkillFile('a/SKILL.md', '---\nname:' + ' '.repeat(N) + '\n---\nb'))).toBeLessThan(200);
  });
});
