// the first run's company answers (company-profile.ts): they set the connect order, the team's
// switches and the first brief's message, and they never hide a door.
// run from packages/shared:
//   pnpm test company-profile
import { describe, expect, it } from 'vitest';
import { CompanyProfileSchema, connectOrder, firstBriefPrompt, teamFromProfile, type CompanyProfile } from '../src/company-profile';

const p = (x: Partial<CompanyProfile>): CompanyProfile => CompanyProfileSchema.parse(x);

describe('the connect order', () => {
  it('puts the help picks first, in the order card 1 shows them', () => {
    expect(connectOrder(p({ sells: 'software', help: ['money', 'product'] }))).toEqual(['github', 'bank', 'mail', 'social', 'posthog']);
  });

  it('puts mail first when nothing is picked, and GitHub next for software', () => {
    expect(connectOrder(p({ sells: 'software' }))).toEqual(['mail', 'github', 'bank', 'social', 'posthog']);
  });

  it('puts GitHub last for a company that sells no software', () => {
    expect(connectOrder(p({ sells: 'store' }))).toEqual(['mail', 'bank', 'social', 'posthog', 'github']);
  });

  it('drops a tool the server cannot connect, and never repeats a row', () => {
    expect(connectOrder(p({ sells: 'software', help: ['mail', 'product'] }), ['github', 'bank', 'social'])).toEqual(['github', 'bank', 'social']);
  });

  it('reads a skipped card as no answers', () => {
    expect(connectOrder(null)).toEqual(['mail', 'bank', 'social', 'posthog', 'github']);
  });
});

describe('the team switches', () => {
  it('turns on the agent for each help pick', () => {
    expect(teamFromProfile(p({ sells: 'services', help: ['money', 'customers'] }))).toEqual({ ledger: true, product: false, plume: true });
  });

  it('keeps the product crew on for software', () => {
    expect(teamFromProfile(p({ sells: 'software', help: ['mail'] })).product).toBe(true);
  });

  it('keeps today\'s team after a skip', () => {
    expect(teamFromProfile(p({ skipped: true }))).toEqual({ ledger: false, product: true, plume: false });
    expect(teamFromProfile(null)).toEqual({ ledger: false, product: true, plume: false });
  });
});

describe('the first brief message', () => {
  it('names each connected source once, in one sentence', () => {
    expect(firstBriefPrompt({ company: 'Fieldnote', connected: ['mail', 'github', 'bank'] }))
      .toBe('Make my first brief for Fieldnote. Read my mail from the last 7 days, what shipped on GitHub in the last 14 days and my bank. Tell me what needs me today.');
  });

  it('asks for posts only when a network is connected and a website is known', () => {
    expect(firstBriefPrompt({ company: 'Fieldnote', website: 'fieldnote.app', connected: ['mail', 'social'] }))
      .toBe('Make my first brief for Fieldnote. Read my mail from the last 7 days. Draft three posts from fieldnote.app. Tell me what needs me today.');
  });

  it('works from the website when nothing is connected', () => {
    expect(firstBriefPrompt({ company: 'Fieldnote', website: 'fieldnote.app', connected: [] }))
      .toBe('Make my first brief for Fieldnote. Read fieldnote.app and write a one-page company brief. Tell me what needs me today.');
  });

  it('asks the person when there is no tool and no website', () => {
    expect(firstBriefPrompt({ company: ' ', connected: [] }))
      .toBe('Make my first brief for my company. Ask me what the company does, then write a one-page company brief. Tell me what needs me today.');
  });

  it('writes no dash and no semicolon (ASD-STE100)', () => {
    const all = [firstBriefPrompt({ company: 'A', website: 'a.app', connected: ['mail', 'github', 'bank', 'social'] }), firstBriefPrompt({ company: 'A', connected: [] })];
    for (const s of all) expect(s).not.toMatch(/[—;]/);
  });
});
