// The reply queue (models-and-replies round): the post id an X link carries, the reply box link
// that opens with the text in it, the times a queue takes, and the words a reminder says.
import { describe, expect, it } from 'vitest';
import { REPLY_GAPS, isReplyGap, queueTimes, reminderOwed, reminderWords, replyIntentUrl, replyOpenUrl, xPostId } from '../src/replyqueue';

const row = (url: string, platform: 'x' | 'linkedin' = 'x', draft = 'Agreed. The hand-off is where context drops & plans help.') => ({
  draft, target: { handle: 'loopwright', url, platform, source: 'connector' as const, text: 'agent teams fail at the hand-off' },
});

describe('xPostId', () => {
  it('reads the id from x.com, twitter.com, www and mobile links, with a query or a trailing path', () => {
    expect(xPostId('https://x.com/eng_khairallah1/status/2105769157317013669')).toBe('2105769157317013669');
    expect(xPostId('https://twitter.com/a/status/12345678?s=20')).toBe('12345678');
    expect(xPostId('https://mobile.x.com/a/statuses/123456/photo/1')).toBe('123456');
    expect(xPostId('https://www.x.com/a/status/987654#m')).toBe('987654');
  });

  it('refuses a link that is not a post, or another site that copies the shape', () => {
    expect(xPostId('https://x.com/loopwright')).toBeNull();
    expect(xPostId('https://x.com.evil.example/a/status/123456')).toBeNull();
    expect(xPostId('https://notx.com/a/status/123456')).toBeNull();
  });
});

describe('replyIntentUrl', () => {
  it('opens X with the reply in it, the text encoded once', () => {
    const u = replyIntentUrl(row('https://x.com/loopwright/status/1234567'))!;
    expect(u.startsWith('https://x.com/intent/tweet?in_reply_to=1234567&text=')).toBe(true);
    expect(new URL(u).searchParams.get('text')).toBe('Agreed. The hand-off is where context drops & plans help.');
  });

  it('is null for another network or a link with no post id, and the open link falls back to the post', () => {
    expect(replyIntentUrl(row('https://www.linkedin.com/feed/update/1', 'linkedin'))).toBeNull();
    expect(replyIntentUrl(row('https://x.com/loopwright'))).toBeNull();
    expect(replyOpenUrl(row('https://www.linkedin.com/feed/update/1', 'linkedin'))).toBe('https://www.linkedin.com/feed/update/1');
  });
});

describe('queueTimes', () => {
  it('spaces the replies the gap apart from the first time', () => {
    const t0 = Date.UTC(2026, 9, 3, 15, 10);
    expect(queueTimes(3, t0, 8)).toEqual([t0, t0 + 8 * 60_000, t0 + 16 * 60_000]);
    expect(queueTimes(0, t0, 5)).toEqual([]);
  });

  it('knows the four gaps and nothing else', () => {
    expect(REPLY_GAPS).toEqual([5, 8, 12, 20]);
    expect(isReplyGap(8)).toBe(true);
    expect(isReplyGap(7)).toBe(false);
    expect(isReplyGap('8')).toBe(false);
  });
});

describe('the reminder', () => {
  it('owes only queued and due rows', () => {
    expect(['queued', 'due', 'opened', 'posted', 'skipped'].map(reminderOwed)).toEqual([true, true, false, false, false]);
  });

  it('says what a tap does, by where it opens', () => {
    expect(reminderWords({ letter: 'B', handle: 'loopwright', open_url: 'https://x.com/intent/tweet?in_reply_to=1&text=a' }))
      .toEqual({ title: 'Reply B is ready to post', body: '@loopwright · Tap to open it in X with the text in it.' });
    expect(reminderWords({ letter: 'C', handle: 'pm', open_url: 'https://www.linkedin.com/feed/update/1' }).body)
      .toBe('@pm · Tap to open the post. Copy the reply from the card.');
  });
});
