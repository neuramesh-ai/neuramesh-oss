import { describe, expect, it } from 'vitest';
import { authCardBlock, authDecisionQuestion, authNoticeCopy, cardNotification, parseAuthCard, type NmAuth } from '../src/cards';

const routine: NmAuth = { provider: 'anthropic', reason: 'unavailable', agent: 'bosun', why: 'This machine has no Claude login.', work: { kind: 'routine', title: 'Weekly research' } };
describe('provider failure explanations', () => {
  it('identifies the failed routine and actual missing CLI login before recovery instructions', () => {
    const copy = authNoticeCopy(routine, 'the cloud machine');
    expect(copy.title).toBe('Routine could not run');
    expect(copy.reason).toBe('Claude Code login unavailable on the cloud machine.');
    const notification = cardNotification(authCardBlock(routine), '#build');
    expect(notification?.title).toBe('Routine could not run · #build');
    expect(notification?.body).toBe('Claude Code login unavailable on the cloud machine. Open NeuraMesh to choose how to continue.');
    expect(authDecisionQuestion(routine)).toContain('Routine could not run. Claude Code login unavailable');
  });
  it('never describes an automatic fallback as a failed routine', () => {
    const copy = authNoticeCopy({ ...routine, switched: true });
    expect(copy.title).toBe('Routine continuing on NeuraMesh brain');
    expect(copy.action).toContain('continues on NeuraMesh credits');
    expect(copy.action).not.toContain('failed');
  });
  it('distinguishes expired credentials, capacity and credits, including legacy cards', () => {
    expect(authNoticeCopy({ provider: 'anthropic', reason: 'expired' }).reason).toBe('Claude Code login expired on this machine.');
    expect(authNoticeCopy({ provider: 'openai', why: 'The usage limit on gpt-6 is reached.' }).reason).toBe('The usage limit on gpt-6 is reached.');
    expect(authNoticeCopy({ ...routine, starter: false }).action).not.toContain('Use NeuraMesh brain');
    expect(authNoticeCopy({ provider: 'anthropic' }).title).toBe('Reply could not run');
  });
  it('retains valid context in stored cards and ignores unsupported context', () => {
    expect(parseAuthCard(authCardBlock(routine))).toEqual(routine);
    expect(parseAuthCard(authCardBlock({ provider: 'anthropic', work: { kind: 'bogus' } } as unknown as NmAuth))).toEqual({ provider: 'anthropic' });
  });
});
