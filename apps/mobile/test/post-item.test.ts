// What a calendar item is (the mobile fix round, 2026-09-06). The rule that matters most: a draft
// with no time must survive, because dropping it is the fault George reported.
import { describe, expect, it } from 'vitest';
import { canDrawPicture, drawRequest, hasPicture, platformName, postHeadline, postMedia, postSlot, slotFields, slotToIso } from '../src/post-item';

const draft = { status: 'draft', scheduled_at: null, published_at: null, media: null as string | null };

describe('postSlot', () => {
  it('has no slot for a draft nobody scheduled', () => {
    expect(postSlot(draft)).toBeNull();
  });
  it('reads a scheduled time, and a published one only once published', () => {
    expect(postSlot({ ...draft, status: 'scheduled', scheduled_at: '2026-09-07T09:00:00.000Z' })?.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    expect(postSlot({ ...draft, published_at: '2026-09-01T09:00:00.000Z' })).toBeNull();
    expect(postSlot({ ...draft, status: 'published', published_at: '2026-09-01T09:00:00.000Z' })?.toISOString()).toBe('2026-09-01T09:00:00.000Z');
  });
  it('treats a malformed stamp as no slot rather than as an invalid date', () => {
    expect(postSlot({ ...draft, status: 'scheduled', scheduled_at: 'soon' })).toBeNull();
  });
});

describe('postMedia and the picture', () => {
  it('survives a broken media column', () => {
    expect(postMedia({ media: '{oops' })).toBeNull();
    expect(postMedia({ media: null })).toBeNull();
  });
  it('sees a picture from a thumb or a hosted url', () => {
    expect(hasPicture(postMedia({ media: '{"thumb":"data:image/png;base64,x"}' }))).toBe(true);
    expect(hasPicture(postMedia({ media: '{"image_url":"https://x/y.png"}' }))).toBe(true);
    expect(hasPicture(postMedia({ media: '{"brief":"a robot"}' }))).toBe(false);
  });
  it('offers a redraw on a draft that already has one, and never on a scheduled post', () => {
    expect(canDrawPicture({ status: 'draft', media: '{"brief":"a robot","thumb":"data:image/png;base64,x"}' })).toBe(true);
    expect(canDrawPicture({ status: 'draft', media: '{"thumb":"data:image/png;base64,x"}' })).toBe(false);
    expect(canDrawPicture({ status: 'scheduled', media: '{"brief":"a robot"}' })).toBe(false);
  });
  it('asks for the picture with the marker the daemon reads', () => {
    expect(drawRequest('c1', false)).toContain('‹gen-image:c1›');
    expect(drawRequest('c1', true)).toContain('Redraw');
  });
});

describe('the row and the slot fields', () => {
  it('takes the first line and cuts it', () => {
    expect(postHeadline('Your people.\nYour agents.')).toBe('Your people.');
    expect(postHeadline('x'.repeat(60))).toBe(`${'x'.repeat(48)}…`);
  });
  it('names a network, and passes an unknown one through', () => {
    expect(platformName('x')).toBe('X');
    expect(platformName('linkedin')).toBe('LinkedIn');
    expect(platformName('threads')).toBe('threads');
  });
  it('refuses a malformed date or time rather than sending an invalid instant', () => {
    expect(slotToIso('2026-09-07', '09:00')).not.toBeNull();
    expect(slotToIso('7/9/2026', '09:00')).toBeNull();
    expect(slotToIso('2026-09-07', '9:00')).toBeNull();
    expect(slotToIso('2026-09-07', '24:00')).toBeNull();
  });
  it('offers an hour from now for a draft with no slot', () => {
    const now = new Date('2026-09-06T08:15:00');
    expect(slotFields(draft, now)).toEqual({ date: '2026-09-06', time: '09:15' });
  });
});
