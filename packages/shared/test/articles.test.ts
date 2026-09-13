// The article derivation (docs/design/article-deliverables-2026-08): pure, so the thread card,
// the Files preview and the reading tab render one truth about what the article says it is.
import { describe, expect, it } from 'vitest';
import { articleFacts, articleFrom, parseArticleRef } from '../src/articles';

const MD = `# The Next Era of Mental Health AI Will Know When to Stop Talking

AI is already becoming part of how people handle stress, anxiety, and difficult moments. The important question is no longer whether people will use it.

![the loop](data:image/png;base64,AAA)

The strongest answer may not be an "AI therapist" that keeps the conversation going forever.

## Sources

1. [The state of digital mental-health interventions](https://nature.com/x)
2. [Guardrails and hand-off design](https://jmir.org/y)
`;

describe('parseArticleRef', () => {
  it('lifts the marker and keeps the prose — the wb/unit anatomy', () => {
    const r = parseArticleRef('Research done — the article, below.\n\n‹article:art-9›');
    expect(r).toEqual({ id: 'art-9', prose: 'Research done — the article, below.' });
    expect(parseArticleRef('no marker here')).toBeNull();
  });
});

describe('articleFrom', () => {
  it('derives title, dek, hero, counts and sources from the markdown alone', () => {
    const a = articleFrom('next-era.md', MD);
    expect(a.title).toBe('The Next Era of Mental Health AI Will Know When to Stop Talking');
    expect(a.dek).toMatch(/^AI is already becoming part/);
    expect(a.hero).toBe('data:image/png;base64,AAA');
    expect(a.images).toBe(1);
    expect(a.sources).toBe(2);
    expect(a.minutes).toBeGreaterThanOrEqual(1);
    expect(articleFacts(a)).toContain('2 sources');
  });

  it('degrades honestly: no heading → the filename; no prose → empty dek; 1 min floor', () => {
    const a = articleFrom('findings.md', '- bullet one\n- bullet two');
    expect(a.title).toBe('findings');
    expect(a.dek).toBe('');
    expect(a.hero).toBeNull();
    expect(a.minutes).toBe(1);
    expect(a.sources).toBe(0);
  });

  it('never counts code fences or link targets as words, and strips md from the dek', () => {
    const a = articleFrom('x.md', '# T\n\nA **bold** [link](https://very-long-url.example/aaaa) here.\n\n```js\nconst noise = 1;\n```');
    expect(a.dek).toBe('A bold link here.');
    expect(a.words).toBe(5); // T + A bold link here — the fence and the URL never count
  });
});
