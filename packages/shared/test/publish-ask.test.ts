import { describe, expect, it } from 'vitest';
import { parsePublishAsk, publishAskMarker, publishableName, publishedMarker } from '../src/publish-ask';

const ID = '6f1c0e1a-0000-4000-8000-000000000001';

describe('the publish ask marker', () => {
  it('round-trips the file and the line, and keeps the prose', () => {
    const marker = publishAskMarker(ID, 'The video block in the email to Lena');
    expect(marker).toBe(`‹publish:${ID}|The video block in the email to Lena›`);
    expect(parsePublishAsk(`I ask to publish the video.\n${marker}`)).toEqual({ id: ID, for: 'The video block in the email to Lena', prose: 'I ask to publish the video.', done: false });
  });

  it('clears the brackets and the bar from the line, and needs a file id', () => {
    expect(publishAskMarker(ID, 'a ‹b› | c\nd')).toBe(`‹publish:${ID}|a b c d›`);
    expect(parsePublishAsk(`‹publish:${ID}›`)).toEqual({ id: ID, for: '', prose: '', done: false });
    expect(parsePublishAsk('‹publish:not-a-file›')).toBeNull();
    expect(parsePublishAsk('no marker here')).toBeNull();
  });

  it('reads the API\'s message after an agent publish as the card in its published state', () => {
    const marker = publishedMarker(ID, 'The deck for the investors');
    expect(marker).toBe(`‹published:${ID}|The deck for the investors›`);
    expect(parsePublishAsk(`Published: https://acme.neuramesh.page/p/x ${marker}`)).toEqual({ id: ID, for: 'The deck for the investors', prose: 'Published: https://acme.neuramesh.page/p/x', done: true });
  });

  it('names the files that can go out, within the size limits', () => {
    for (const n of ['demo.mp4', 'demo.webm', 'a.PNG', 'b.jpeg', 'c.jpg', 'd.webp', 'e.gif', 'deck.html', 'deck.htm']) expect(publishableName(n, 1000)).toBe(true);
    for (const n of ['logo.svg', 'deck.pdf', 'notes.md', 'clip.mov', 'data.csv']) expect(publishableName(n, 1000)).toBe(false);
    expect(publishableName('deck.html', 6 * 1024 * 1024)).toBe(false);
    expect(publishableName('demo.mp4', 201 * 1024 * 1024)).toBe(false);
    expect(publishableName('demo.mp4', null)).toBe(true);
  });
});
