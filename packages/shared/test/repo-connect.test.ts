// The GitHub card's shared words (docs/design/repo-connect-2026-10): the Needs-you question it mints,
// the divider the grant posts, how a transcript reads both, and the card's place among the cards.
import { describe, expect, it } from 'vitest';
import { cardNotification, cardsAsWords, GITHUB_NEED_PREFIX, githubConnectedMarker, githubConnectedWords, isGitHubNeedQuestion, needBlock, needCardText, needDecisionQuestion, parseCard, parseGitHubConnected, parseNeed } from '../src/index';

const card = needBlock({ channel: 'ch', ask: 'Storage interface investigation', why: 'This conversation reads the code in neuramesh.', connect: ['github'], after: 'rex continues here when GitHub is connected.' });

describe('the GitHub card', () => {
  it('mints one question per ask, under the prefix the resume finds it by', () => {
    const q = needDecisionQuestion(parseNeed(card)!);
    expect(q).toBe(`${GITHUB_NEED_PREFIX}Storage interface investigation waits to read the repository.`);
    expect(isGitHubNeedQuestion(q!)).toBe(true);
    expect(isGitHubNeedQuestion('Ship the banner to prod?')).toBe(false);
    // an account card (X, LinkedIn) is not a GitHub card: it mints nothing the resume would answer
    expect(needDecisionQuestion(parseNeed(needBlock({ channel: 'ch', ask: 'The radar', why: 'it reads X', connect: ['x'] }))!)).toBeNull();
  });

  it('carries its foot, trimmed and capped, and drops an empty one', () => {
    expect(parseNeed(card)?.after).toBe('rex continues here when GitHub is connected.');
    expect(parseNeed(needBlock({ channel: 'ch', ask: 'a', why: 'b', connect: ['github'], after: '   ' }))?.after).toBeUndefined();
    expect(parseNeed(needBlock({ channel: 'ch', ask: 'a', why: 'b', connect: ['github'], after: 'x'.repeat(300) }))?.after).toHaveLength(200);
  });

  it('is a blocking card: it outranks a question, notifies as an action, and loses only to a reconnect', () => {
    expect(parseCard(`lead\n\n${card}`)).toEqual({ kind: 'nmneed' });
    expect(parseCard(`${card}\n\n\`\`\`nmq\n{"question":"q"}\n\`\`\``)).toEqual({ kind: 'nmneed' });
    expect(parseCard(`${card}\n\n\`\`\`nmauth\n{"provider":"openai"}\n\`\`\``)).toEqual({ kind: 'nmauth' });
    expect(cardNotification(`I need to read the code in neuramesh for this, and nothing here can read it yet.\n\n${card}`, '#build')).toEqual({
      kind: 'nmneed', title: 'Action needed · #build', body: 'I need to read the code in neuramesh for this, and nothing here can read it yet.',
    });
  });

  it('reads as words in a transcript, never as a block to copy', () => {
    const words = cardsAsWords(`I need to read the code in neuramesh for this.\n\n${card}`);
    expect(words).not.toContain('```');
    expect(words).toContain('I need to read the code in neuramesh for this.');
    expect(words).toContain('[a card asks the person to connect GitHub before “Storage interface investigation” can run. The work waits for it.]');
    expect(needCardText('no card here')).toBe('no card here');
  });
});

describe('the connected divider', () => {
  it('round-trips the repository, and nothing else parses as one', () => {
    const m = githubConnectedMarker('alonge-dev/neuramesh');
    expect(m).toBe('‹github:connected:alonge-dev/neuramesh›');
    expect(parseGitHubConnected(m)).toBe('alonge-dev/neuramesh');
    expect(parseGitHubConnected(`  ${m}\n`)).toBe('alonge-dev/neuramesh');
    expect(parseGitHubConnected(`I said ${m}`)).toBeNull();
    expect(parseGitHubConnected('‹github:connected:no-slash›')).toBeNull();
    expect(parseGitHubConnected(null)).toBeNull();
  });

  it('reads as the person\'s grant in a transcript, so the agent continues the ask', () => {
    expect(cardsAsWords(githubConnectedMarker('acme/site'))).toBe(githubConnectedWords('acme/site'));
    expect(githubConnectedWords('acme/site')).toMatch(/^\[the person connected GitHub: acme\/site\. The repository is readable now\. Continue/);
  });
});
