// The brain notice: ONE pure derivation from the conversation's messages and its brain override,
// read by the desktop's docked bar (and the phone, when it wants it). These tests are the contract:
// when the bar stands, in which state, and exactly what makes it leave.
import { describe, expect, it } from 'vitest';
import { brainNoticeLine, brainNoticeOf, brainNoticeText, type NoticeMessage } from '../src/brainnotice';
import { authCardBlock, type NmAuth } from '../src/cards';
import { STARTER_MODEL } from '../src/rates';

const T1 = 't-1';
const offer: NmAuth = { provider: 'openai', reason: 'unavailable', agent: 'rex', why: 'This machine has no OpenAI / Codex login.', starter: true, scope: { threadId: T1, role: 'orchestrator' } };
const switched: NmAuth = { ...offer, switched: true };
const msg = (id: string, author_kind: string, body: string, created_at: string): NoticeMessage => ({ id, author_kind, body, created_at });
const human = (id: string, at: string) => msg(id, 'human', '@rex one line, please.', at);
const agentCard = (id: string, card: NmAuth, at: string) => msg(id, 'agent', `@rex cannot run on OpenAI / Codex here.\n\n${authCardBlock(card)}`, at);
const agentReply = (id: string, at: string) => msg(id, 'agent', 'This room has eight open tasks.', at);

describe('brainNoticeOf', () => {
  it('nothing without a card', () => {
    expect(brainNoticeOf([human('m1', '2026-09-18T00:00:00Z'), agentReply('m2', '2026-09-18T00:00:01Z')], null)).toBeNull();
  });

  it('an offer that nobody acted on NEEDS you', () => {
    const n = brainNoticeOf([human('m1', '2026-09-18T00:00:00Z'), agentCard('m2', offer, '2026-09-18T00:00:01Z')], null);
    expect(n).toMatchObject({ state: 'needs', messageId: 'm2', auto: false });
    expect(brainNoticeLine(n!)).toEqual({ title: '@rex cannot run here', summary: 'This machine has no OpenAI / Codex login.' });
    expect(brainNoticeText(n!).happened).toMatch(/Nothing moved, so this conversation waits\.$/);
    expect(brainNoticeText(n!).todo).toMatch(/or run this conversation on the NeuraMesh brain, on credits\.$/);
  });

  it('out of credits: the offer names the one way out', () => {
    const n = brainNoticeOf([agentCard('m2', { ...offer, starter: false }, '2026-09-18T00:00:01Z')], null)!;
    expect(brainNoticeText(n).todo).toMatch(/add credits/);
  });

  it('the seat on Starter reads as SWITCHED, by a tap (not auto) when the card was an offer', () => {
    const n = brainNoticeOf([agentCard('m2', offer, '2026-09-18T00:00:01Z')], { orchestrator: STARTER_MODEL });
    expect(n).toMatchObject({ state: 'switched', auto: false });
    expect(brainNoticeLine(n!).title).toBe('@rex runs on the NeuraMesh brain here');
    expect(brainNoticeText(n!).happened).toMatch(/You moved this conversation to the NeuraMesh brain/);
    expect(brainNoticeText(n!).todo).toMatch(/then reset the brain in this conversation to go back\.$/);
  });

  it('a routine\'s recorded switch reads as SWITCHED and auto', () => {
    const n = brainNoticeOf([agentCard('m2', switched, '2026-09-18T00:00:01Z')], { orchestrator: STARTER_MODEL });
    expect(n).toMatchObject({ state: 'switched', auto: true });
    expect(brainNoticeText(n!).happened).toMatch(/This routine continued on the NeuraMesh brain/);
  });

  it('a recorded switch whose seat was RESET stands down — nothing to say', () => {
    expect(brainNoticeOf([agentCard('m2', switched, '2026-09-18T00:00:01Z')], null)).toBeNull();
    expect(brainNoticeOf([agentCard('m2', switched, '2026-09-18T00:00:01Z')], { orchestrator: 'claude-opus-4-8' })).toBeNull();
  });

  it('an offer the agent could answer again after (a reconnect happened) stands down', () => {
    const rows = [agentCard('m2', offer, '2026-09-18T00:00:01Z'), human('m3', '2026-09-18T00:00:02Z'), agentReply('m4', '2026-09-18T00:00:03Z')];
    expect(brainNoticeOf(rows, null)).toBeNull();
  });

  it('a human reply alone does not clear it — the agent still cannot run', () => {
    const rows = [agentCard('m2', offer, '2026-09-18T00:00:01Z'), human('m3', '2026-09-18T00:00:02Z')];
    expect(brainNoticeOf(rows, null)?.state).toBe('needs');
  });

  it('the NEWEST card wins whatever the message order, and a card from a human is not a card', () => {
    const rows = [agentCard('m5', switched, '2026-09-18T00:00:05Z'), agentCard('m2', offer, '2026-09-18T00:00:01Z'), msg('m6', 'human', authCardBlock(offer), '2026-09-18T00:00:06Z')];
    expect(brainNoticeOf(rows, { orchestrator: STARTER_MODEL })).toMatchObject({ messageId: 'm5', state: 'switched', auto: true });
  });

  it('a card with no scope cannot be on Starter, so it only ever needs you', () => {
    const bare: NmAuth = { provider: 'anthropic', reason: 'expired', agent: 'patch' };
    const n = brainNoticeOf([agentCard('m2', bare, '2026-09-18T00:00:01Z')], { developer: STARTER_MODEL });
    expect(n?.state).toBe('needs');
    expect(brainNoticeLine(n!).summary).toBe('The Claude login on this machine expired.');
  });
});
