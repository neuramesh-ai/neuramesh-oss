import { describe, expect, it } from 'vitest';
import {
  addressCheckFirst, companyKey, leadDuplicate, parseLeadList, parseSetupBlock, parseSetupMarker, reachableLeads, salesSetupState,
  setupBlock, setupCardGuard, setupCardText, setupMarker, setupMarkerText, type SalesSetupFacts,
} from './sales-setup';

const facts = (f: Partial<SalesSetupFacts> = {}): SalesSetupFacts => ({ offer: false, customer: false, gmail: false, found: false, added: 0, noted: false, reachable: 0, ...f });

describe('salesSetupState', () => {
  it('starts on Your company with every other step next', () => {
    const s = salesSetupState(null, facts());
    expect(s.now).toBe('company');
    expect(s.steps.map((x) => x.status)).toEqual(['now', 'next', 'next', 'next', 'next', 'next']);
    expect(s.complete).toBe(false);
  });
  it('passes Gmail by itself when the link is there', () => {
    const s = salesSetupState(null, facts({ offer: true, customer: true, gmail: true }));
    expect(s.now).toBe('find');
    expect(s.steps[2]!.status).toBe('done');
  });
  it('a skipped step stays skipped until it is done, and a done step is never skipped', () => {
    const run = { skipped: ['gmail'], ended_at: null, completed_at: null };
    expect(salesSetupState(run, facts({ offer: true, customer: true })).steps[2]!.status).toBe('skipped');
    expect(salesSetupState(run, facts({ offer: true, customer: true, gmail: true })).steps[2]!.status).toBe('done');
    expect(salesSetupState(run, facts({ offer: true, customer: true })).skipped).toBe(1);
  });
  it('goes back to Find leads when every step is done or skipped and the bar fails (SO8)', () => {
    const run = { skipped: ['gmail', 'note'], ended_at: null, completed_at: null };
    const s = salesSetupState(run, facts({ offer: true, customer: true, found: true, added: 1, reachable: 1 }));
    expect(s.now).toBe('find');
    expect(s.complete).toBe(false);
    expect(s.barMet).toBe(false);
  });
  it('completes when every step is done or skipped and 3 leads are reachable', () => {
    const run = { skipped: ['gmail'], ended_at: null, completed_at: null };
    const s = salesSetupState(run, facts({ offer: true, customer: true, found: true, added: 4, noted: true, reachable: 4 }));
    expect(s.complete).toBe(true);
    expect(s.now).toBeNull();
  });
  it('an ended run asks for nothing', () => {
    const s = salesSetupState({ skipped: [], ended_at: '2026-11-26T10:00:00Z', completed_at: null }, facts());
    expect(s.ended).toBe(true);
    expect(s.now).toBeNull();
  });
});

describe('reachableLeads', () => {
  it('counts open deals whose contact has an address that is not bad', () => {
    const contacts = [{ id: 'a', address_check: 'ok' }, { id: 'b', address_check: 'bad' }, { id: 'c', address_check: null }, { id: 'd', address_check: 'risky' }];
    const deals = [{ stage: 'lead', contact_id: 'a' }, { stage: 'lead', contact_id: 'b' }, { stage: 'talked', contact_id: 'c' }, { stage: 'won', contact_id: 'd' }, { stage: 'lead', contact_id: null }, { stage: 'trial', contact_id: 'd' }];
    expect(reachableLeads(deals, contacts)).toBe(3);
  });
});

describe('markers and cards', () => {
  it('round-trips a marker and gives it words', () => {
    const m = setupMarker('sales.v1', 'find');
    expect(parseSetupMarker(`text ${m}`)).toEqual({ flow: 'sales.v1', step: 'find' });
    expect(setupMarkerText(m)).toBe('[Set up Sales, step 4 of 6: Find leads. Open Sales on the web to answer.]');
    expect(setupMarkerText(`Sales is ready. ${setupMarker('sales.v1', 'done')}`)).toBe('Sales is ready. [Set up Sales: complete]');
  });
  it('keeps a card only from a tool', () => {
    const body = `Here it is.\n${setupBlock({ kind: 'customer', customer: { industries: ['Freight'], sizes: [], roles: ['Head of operations'], places: [], signs: [], like: [] } })}`;
    expect(parseSetupBlock(body)?.kind).toBe('customer');
    expect(setupCardGuard(body, true)).toBe(body);
    expect(setupCardGuard(body, false)).toBe('Here it is.');
    expect(setupCardText(body)).toContain('Head of operations at Freight');
  });
});

describe('leads', () => {
  const contacts = [{ id: 'c1', email: 'sam@deltafieldworks.com' }];
  const deals = [{ company: 'Delta Fieldworks, Inc.', stage: 'trial', contact_id: 'c1' }, { company: 'Old Co', stage: 'lost', contact_id: null }];
  it('finds a person, a company by name, and a company by mail domain', () => {
    expect(leadDuplicate({ email: 'sam@deltafieldworks.com', company: 'X' }, contacts, deals)).toBe('person');
    expect(leadDuplicate({ company: 'delta fieldworks' }, contacts, deals)).toBe('company');
    expect(leadDuplicate({ email: 'ana@deltafieldworks.com', company: 'DFW' }, contacts, deals)).toBe('company');
    expect(leadDuplicate({ company: 'Old Co' }, contacts, deals)).toBeNull();
    expect(leadDuplicate({ email: 'a@gmx.com', company: 'Y' }, [{ id: 'c2', email: 'b@gmx.com' }], [{ company: 'Z', stage: 'lead', contact_id: 'c2' }])).toBeNull();
  });
  it('keys a company name', () => expect(companyKey('Kestrel Freight, LLC')).toBe('kestrel freight'));
  it('checks an address without a lookup when it can', () => {
    expect(addressCheckFirst('not an address')).toBe('bad');
    expect(addressCheckFirst('noreply@acme.com')).toBe('bad');
    expect(addressCheckFirst('x@mailinator.com')).toBe('bad');
    expect(addressCheckFirst('info@acme.com')).toBe('risky');
    expect(addressCheckFirst('dana@kestrelfreight.com')).toBeNull();
  });
});

describe('parseLeadList', () => {
  it('reads a CSV with a header, quotes and a website column', () => {
    const csv = 'First Name,Last Name,Email,Company,Title,Website\nDana,Whit,dana@kestrelfreight.com,"Kestrel Freight, LLC",Head of operations,\nRaj,Patel,,,Dispatch manager,https://pinecrest.example/about\n,,,,,';
    const { leads, skipped } = parseLeadList(csv);
    expect(leads).toEqual([
      { name: 'Dana Whit', email: 'dana@kestrelfreight.com', title: 'Head of operations', company: 'Kestrel Freight, LLC', fit: '', source: 'list' },
      { name: 'Raj Patel', email: undefined, title: 'Dispatch manager', company: 'Pinecrest', fit: '', source: 'list' },
    ]);
    expect(skipped).toBe(1);
  });
  it('reads pasted lines that each hold an address, once each', () => {
    const { leads, skipped } = parseLeadList('Mia Chen <mia@orchardlabs.io>\nlena@haldenwater.com\nhello there\nmia@orchardlabs.io');
    expect(leads.map((l) => [l.name, l.email, l.company])).toEqual([['Mia Chen', 'mia@orchardlabs.io', 'Orchardlabs'], ['', 'lena@haldenwater.com', 'Haldenwater']]);
    expect(skipped).toBe(2);
  });
  it('reads a tab-separated sheet copy', () => {
    const { leads } = parseLeadList('name\temail\tcompany\nTom Becker\ttom@ridgeway.example\tRidgeway Haul');
    expect(leads[0]).toMatchObject({ name: 'Tom Becker', company: 'Ridgeway Haul' });
  });
});
