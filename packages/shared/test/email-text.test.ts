// the plain-text part of every email (toText, email/layout.ts). two defects lived here until
// 2026-10-03, in every email that went out: an h2 ran into the paragraph under it ("What they can
// seeA workspace member…"), and every link lost its address, because the `<https://…>` the
// converter wrote read as a tag to its own tag strip. a person who reads mail as text met headings
// glued to sentences and buttons with nowhere to go, the footer's Unsubscribe included.
import { describe, expect, it } from 'vitest';
import { renderBroadcast, renderDay7, renderDigest, renderMarketing, renderPublishFailed, TEMPLATE_META, type RenderedEmail } from '../src/email/templates';
import { renderDay1, renderDay3, renderWelcome } from '../src/email/templates-lifecycle';
import { renderInvite, renderJoined, renderTrialEnding } from '../src/email/templates-account';
import { renderAnnounceReady } from '../src/email/templates-announce';
import { button, h2, p, toText } from '../src/email/layout';

const HQ = 'https://hq.example';
const unsub = 'https://api.example/u/demo.token';

// one of each template the registry lists, so a new template has to join this list to pass
const EMAILS: Record<string, RenderedEmail> = {
  invite: renderInvite({ inviter: 'George', inviterEmail: 'g@example.com', workspace: 'Flowe', role: 'Member', acceptUrl: 'https://site.example/join?token=t' }),
  joined: renderJoined({ joinedEmail: 'ada@flowe.dev', workspace: 'Flowe', role: 'Member', seatLine: null, openUrl: HQ }),
  trialEnding: renderTrialEnding({ workspace: 'Flowe', endsOn: 'Oct 17', seats: 1, seatUsd: 22, manageUrl: `${HQ}/?view=credits` }),
  publishFailed: renderPublishFailed({ platform: 'X', slot: '09:00 today', error: '401 Unauthorized', queuedBehind: 2, reconnectUrl: `${HQ}/connect` }),
  welcome: renderWelcome({ openUrl: HQ, unsubscribeUrl: unsub }),
  day1: renderDay1({ openUrl: HQ, unsubscribeUrl: unsub }),
  day3: renderDay3({ lesson: 'Never mock the database.', taskNumber: 1042, channel: 'dev', reviewer: 'scout', worker: 'patch', statAccepted: 4, statReviews: 11, statLessons: 6, window: 'your first week', openUrl: HQ, unsubscribeUrl: unsub }),
  marketing: renderMarketing({ shippedThing: 'the CSV export', worker: 'patch', reviewer: 'scout', openUrl: HQ, unsubscribeUrl: unsub }),
  day7: renderDay7({ billingUrl: 'https://site.example/pro?mode=signin', openUrl: `${HQ}/?view=credits`, unsubscribeUrl: unsub }),
  digest: renderDigest({ channel: 'marketing', published: 3, waiting: 2, failed: 1, drafted: 6, window: 'this week', openUrl: HQ, unsubscribeUrl: unsub }),
  broadcast: renderBroadcast({ subject: 'News', preheader: 'One thing changed', heading: 'One thing changed', paragraphs: ['A sentence.', 'Another one.'], ctaLabel: 'Open your workspace', ctaUrl: HQ, unsubscribeUrl: unsub }),
  announceReady: renderAnnounceReady({ repo: 'neuramesh-ai/neuramesh-oss', tag: 'v0.134.0', title: 'The browser terminal', networks: ['x', 'linkedin'], site: 'https://site.example', link: 'https://site.example/announce/a1', verdict: 'feature' }),
};

/** the hrefs a reader can follow in the HTML: the VML button copy for Outlook is a comment, so skip it */
const hrefs = (html: string): string[] =>
  [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a[^>]+href="([^"]+)"/gi)].map((m) => m[1]!.replace(/&amp;/g, '&'));
const headings = (html: string): string[] =>
  [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => toText(m[1]!));

describe('toText keeps what a text reader needs', () => {
  it('a heading ends its line, and a link keeps its address', () => {
    const t = toText(h2('To keep Pro') + p('Do nothing.') + button('Manage your plan', 'https://hq.example/?view=credits'));
    expect(t).toBe('To keep Pro\nDo nothing.\nManage your plan <https://hq.example/?view=credits>');
  });

  it('an escaped bracket in the copy stays a bracket, and is never taken for a link', () => {
    expect(toText(p('a &lt;b&gt; c'))).toBe('a <b> c');
  });
});

describe('every email, as text', () => {
  it('covers every template the registry lists', () => {
    expect(Object.keys(EMAILS).sort()).toEqual(Object.keys(TEMPLATE_META).sort());
  });

  for (const [name, email] of Object.entries(EMAILS)) {
    it(`${name}: every link keeps its address`, () => {
      const links = hrefs(email.html);
      expect(links.length).toBeGreaterThan(0);
      for (const href of links) expect(email.text, href).toContain(`<${href}>`);
    });

    it(`${name}: every heading stands on its own line`, () => {
      const lines = email.text.split('\n');
      for (const heading of headings(email.html)) expect(lines, heading).toContain(heading);
    });
  }
});
