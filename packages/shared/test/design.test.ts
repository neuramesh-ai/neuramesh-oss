// The Claude Design links a design round posts, and the two different jobs they do.
import { expect, test } from 'vitest';
import { claudeDesignProjectUrl, claudeDesignUrlFromText } from '../src/design';


// ── the handoff button opens the PROJECT (2026-08-11, George live) ───────────────────────────
// `claudeDesignUrlFromText` keeps whatever the agent posted — a link to one direction is a
// useful link — but the card's button says "Open Claude Design", and it was dropping the human
// into the first direction's file with no route to the other two.
const P = '11111111-2222-3333-4444-555555555555';

test('the project url strips a file query — the live bug', () => {
  expect(claudeDesignProjectUrl(`https://claude.ai/design/p/${P}?open_file=direction-1.html`)).toBe(`https://claude.ai/design/p/${P}`);
});

test('…and a file path, and a fragment', () => {
  expect(claudeDesignProjectUrl(`https://claude.ai/design/p/${P}/file/a.html#top`)).toBe(`https://claude.ai/design/p/${P}`);
});

test('a bare project link passes through, id lowercased', () => {
  expect(claudeDesignProjectUrl(`https://claude.ai/design/p/${P.toUpperCase()}`)).toBe(`https://claude.ai/design/p/${P}`);
});

test('anything that is not a Claude Design project is refused', () => {
  expect(claudeDesignProjectUrl('https://claude.ai/chat/abc')).toBeNull();
  expect(claudeDesignProjectUrl(`https://evil.example/design/p/${P}`)).toBeNull();
  expect(claudeDesignProjectUrl(null)).toBeNull();
});

// the extractor itself still keeps what the agent posted — a link to ONE direction is a useful
// link in the transcript; only the button normalizes (that split is the point)
test('the extractor keeps the agent\'s own link, suffix and all', () => {
  const posted = `Claude Design project ready: https://claude.ai/design/p/${P}?open_file=direction-1.html`;
  expect(claudeDesignUrlFromText(posted)).toBe(`https://claude.ai/design/p/${P}?open_file=direction-1.html`);
});
