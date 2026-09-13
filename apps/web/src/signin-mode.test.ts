import { describe, expect, it } from 'vitest';
import { handoffUrl, signinMode } from './signin-mode';

describe('the handoff page\'s two faces', () => {
  it('reads sign-up only from the exact param; anything else is sign-in', () => {
    expect(signinMode('signup')).toBe('signup');
    expect(signinMode('signin')).toBe('signin');
    expect(signinMode(null)).toBe('signin');
    expect(signinMode('SIGNUP')).toBe('signin');
  });
  it('keeps the nonce on both faces, and the mode only on sign-up', () => {
    expect(handoffUrl('abc', 'signin')).toBe('/desktop-signin?nonce=abc');
    expect(handoffUrl('abc', 'signup')).toBe('/desktop-signin?nonce=abc&mode=signup');
    expect(handoffUrl(null, 'signup')).toBe('/desktop-signin?mode=signup');
  });
  it('serves the /pro page the same way, so Get Pro needs no second sign-in', () => {
    expect(handoffUrl('abc', 'signup', '/pro')).toBe('/pro?nonce=abc&mode=signup');
    expect(handoffUrl('abc', 'signin', '/pro')).toBe('/pro?nonce=abc');
    expect(handoffUrl(null, 'signin', '/pro')).toBe('/pro');
  });
});
