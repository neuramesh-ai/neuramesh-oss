// Deliverables (docs/30): which attached artifacts earn a card, and how they group.
// The rules exist because a submit attaches the agent's own summary as `result.md` —
// live #1032 shipped three artifacts, two of them echoes of messages already on screen.
import { describe, expect, it } from 'vitest';
import { isEchoArtifact, isWorkflowArtifact, isPostsFile, renderableDeliverables, groupDeliveries, supersededIds, fileWeight, fileTag } from '../src/deliverables';

const art = (id: string, name: string, content: string, createdAt: string, kind = 'doc') => ({ id, name, kind, content, createdAt });
const T = (s: number) => new Date(Date.UTC(2026, 6, 25, 18, 0, s)).toISOString();

describe('the echo rule', () => {
  const summary = 'Delivered 1 file: FLOWE_RESEARCH_REPORT.md — attached for review.';

  it('drops result.md when it IS the message posted above it', () => {
    expect(isEchoArtifact(art('a', 'result.md', summary, T(0)), [summary])).toBe(true);
  });

  it('drops it when the artifact carries an extra evidence line the message lacks', () => {
    const withNote = `${summary}\n\n_(2 screenshots over the evidence budget were not attached: a.png, b.png)_`;
    expect(isEchoArtifact(art('a', 'result.md', withNote, T(0)), [summary])).toBe(true);
  });

  it('KEEPS a real deliverable that merely mentions the same words', () => {
    const report = '# Flowe — feature gaps\n\nOutside-in analysis of 8 competitors. Delivered as a single consolidated file.';
    expect(isEchoArtifact(art('b', 'FLOWE_RESEARCH_REPORT.md', report, T(0)), [summary])).toBe(false);
  });

  it('never drops an artifact with no content, and never matches an empty message', () => {
    expect(isEchoArtifact(art('c', 'shot.png', '', T(0), 'screenshot'), [summary])).toBe(false);
    expect(isEchoArtifact(art('d', 'result.md', 'x'.repeat(60), T(0)), ['', '   '])).toBe(false);
  });

  it('a short summary is not enough to swallow a longer file (the 40-char floor)', () => {
    expect(isEchoArtifact(art('e', 'notes.md', 'Done. Everything below is the real report…', T(0)), ['Done.'])).toBe(false);
  });

  it('renderableDeliverables keeps the file and drops the echo', () => {
    const kept = renderableDeliverables(
      [art('a', 'result.md', summary, T(0)), art('b', 'REPORT.md', '# Real report\n\nWith actual content in it.', T(1))],
      [summary],
    );
    expect(kept.map((a) => a.name)).toEqual(['REPORT.md']);
  });
});

describe('workflow artifacts keep their own surface', () => {
  it('only the design mockup is excluded — its handoff card genuinely renders it inline', () => {
    expect(isWorkflowArtifact({ name: 'design-mockup-v2-pricing.html', kind: 'design' })).toBe(true);
  });

  // Founder report 2026-07-28: a research report carded with a readable preview while the
  // implementation plan — the artifact you are being asked to approve — showed only a link.
  // Nothing renders a plan document in the thread, so excluding it wasn't "twice", it was zero.
  it('an implementation plan CARDS — nothing else renders it in the thread', () => {
    expect(isWorkflowArtifact({ name: 'implementation-plan-v1.md', kind: 'doc' })).toBe(false);
    expect(isWorkflowArtifact({ name: 'implementation-plan-v5.md', kind: 'doc' })).toBe(false);
  });

  // The release-plan gate card LOOKS like a second surface but renders the checklist off
  // tasks.ship_plan — round, risk, summary, tickable items — never the ship-plan-vN.md
  // report, and only while ship_review/releasing. The document was invisible either side.
  it('a ship plan CARDS too — the gate card is the checklist, not the report', () => {
    expect(isWorkflowArtifact({ name: 'ship-plan-v1.md', kind: 'ship' })).toBe(false);
    expect(isWorkflowArtifact({ name: 'ship-plan-v2.md', kind: 'ship' })).toBe(false);
  });

  it('a real deliverable that merely LOOKS plan-ish still renders', () => {
    expect(isWorkflowArtifact({ name: 'rollout-plan.md', kind: 'doc' })).toBe(false);
    expect(isWorkflowArtifact({ name: 'FLOWE_RESEARCH_REPORT.md', kind: 'doc' })).toBe(false);
    expect(isWorkflowArtifact({ name: 'nm-1046.diff', kind: 'diff' })).toBe(false);
  });

  it('renderableDeliverables keeps both plans and still drops mockups + echoes', () => {
    const kept = renderableDeliverables([
      art('p', 'implementation-plan-v1.md', '# Plan', T(0)),
      art('s', 'ship-plan-v1.md', '# Release plan', T(1), 'ship'),
      art('d', 'design-mockup-v2-x.html', '<html>', T(2), 'design'),
      art('r', 'REPORT.md', '# Real report with actual content', T(3)),
    ], []);
    expect(kept.map((a) => a.name)).toEqual(['implementation-plan-v1.md', 'ship-plan-v1.md', 'REPORT.md']);
  });

  // Live #1048 looked like a fourth exclusion and is the opposite. The task was NOT typed
  // `content`, so no content_items existed — hiding posts.json would have left the thread with
  // no posts at all, which is emptier, not better. It cards, and FileBody renders it AS POSTS.
  it('the content wire file still CARDS — on a mistyped task it is the only copy of the posts', () => {
    expect(isWorkflowArtifact({ name: 'posts.json', kind: 'file' })).toBe(false);
    expect(isWorkflowArtifact({ name: 'revised.json', kind: 'file' })).toBe(false);
  });

  it('isPostsFile names the wire file once, for every surface that previews it', () => {
    expect(isPostsFile('posts.json')).toBe(true);
    expect(isPostsFile('POSTS.JSON')).toBe(true);
    expect(isPostsFile('revised.json')).toBe(true);
    expect(isPostsFile('scratch/posts.json')).toBe(true); // collectFiles stores relative names
  });

  it('a file that merely mentions posts is not the wire file', () => {
    expect(isPostsFile('posts-analysis.md')).toBe(false);
    expect(isPostsFile('social-media.json')).toBe(false);
    expect(isPostsFile('my-posts.json')).toBe(false);
  });
});

describe('grouping + supersede', () => {
  it('one submit is one delivery; a rework minutes later is its own', () => {
    const g = groupDeliveries([
      art('a', 'result.md', 'x', T(0)),
      art('b', 'notes.md', 'y', T(3)),
      art('c', 'REPORT.md', 'z', T(400)), // 6+ minutes later — the rework
    ]);
    expect(g.map((b) => b.map((a) => a.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('input order does not matter', () => {
    const g = groupDeliveries([art('c', 'z.md', 'z', T(400)), art('a', 'a.md', 'a', T(0))]);
    expect(g.map((b) => b.map((a) => a.id))).toEqual([['a'], ['c']]);
  });

  it('the later file of the same name supersedes the earlier — kept, not hidden', () => {
    const s = supersededIds([art('a', 'result.md', 'first', T(0)), art('b', 'result.md', 'second', T(400)), art('c', 'other.md', 'x', T(1))]);
    expect([...s]).toEqual(['a']);
  });
});

describe('header weight + tag', () => {
  it('prose counts words, diffs count changed lines, csv counts rows', () => {
    expect(fileWeight('report.md', 'doc', 'one two three four five')).toMatch(/^5 w · \d+ B$/);
    expect(fileWeight('nm-1046.diff', 'diff', '@@ -1 +1 @@\n+added\n+more\n-gone')).toBe('+2 −1');
    expect(fileWeight('m.csv', 'file', 'a,b\n1,2\n3,4')).toBe('2 rows');
  });
  it('no content ⇒ no weight, rather than a lie', () => {
    expect(fileWeight('big.zip', 'file', null)).toBe('');
  });
  it('the tag is the extension, else the kind', () => {
    expect(fileTag('FLOWE_RESEARCH_REPORT.md', 'doc')).toBe('md');
    expect(fileTag('Makefile', 'file')).toBe('file');
  });
});
