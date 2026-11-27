// THE FREE ADDRESS CHECK (docs/design/sales-onboarding-2026-11/plan.md SO11). The shape, a no-reply or role mailbox and
// a throwaway domain come from addressCheckFirst (shared). Then DNS: a domain with a mail server (MX), or with an
// address of its own (the RFC 5321 fallback), can take mail. It never probes a mailbox over SMTP, because a probe
// looks like abuse to the receiver. A lookup that times out or fails for another reason is 'risky', never 'bad': a
// slow resolver must not cost the person a lead.
import { promises as dns } from 'node:dns';
import { addressCheckFirst, domainOf, type AddressCheck } from '@neuramesh/shared';

export interface Resolver { mx(domain: string): Promise<unknown[]>; a(domain: string): Promise<unknown[]> }
const SYSTEM: Resolver = { mx: (d) => dns.resolveMx(d), a: (d) => dns.resolve4(d) };
let current: Resolver = SYSTEM;
/** for tests: answer lookups with no network. Null puts DNS back */
export const useResolver = (r: Resolver | null): void => { current = r ?? SYSTEM; cache.clear(); };
const TIMEOUT_MS = 2500;
const TTL_MS = 60 * 60_000;
const cache = new Map<string, { at: number; check: AddressCheck }>();
const NONE = new Set(['ENOTFOUND', 'ENODATA', 'ENONAME', 'NXDOMAIN']);

const within = <T>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<T>((_, no) => setTimeout(() => no(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), TIMEOUT_MS))]);

async function domainCheck(domain: string, r: Resolver): Promise<AddressCheck> {
  try {
    if ((await within(r.mx(domain))).length) return 'ok';
  } catch (e) {
    if (!NONE.has((e as { code?: string }).code ?? '')) return 'risky';
  }
  try {
    return (await within(r.a(domain))).length ? 'ok' : 'bad';
  } catch (e) {
    return NONE.has((e as { code?: string }).code ?? '') ? 'bad' : 'risky';
  }
}

/** one address: 'ok', 'risky' (a role mailbox, or a lookup that did not answer) or 'bad' */
export async function checkAddress(email: string, r: Resolver = current, now = Date.now()): Promise<AddressCheck> {
  const first = addressCheckFirst(email);
  if (first === 'bad') return 'bad';
  const domain = domainOf(email);
  const hit = cache.get(domain);
  const byDomain = hit && now - hit.at < TTL_MS ? hit.check : await domainCheck(domain, r);
  if (!hit || now - hit.at >= TTL_MS) cache.set(domain, { at: now, check: byDomain });
  if (byDomain === 'bad') return 'bad';
  return first ?? byDomain;
}

/** many addresses, each domain asked once */
export async function checkAddresses(emails: readonly string[], r: Resolver = current): Promise<Map<string, AddressCheck>> {
  const out = new Map<string, AddressCheck>();
  await Promise.all([...new Set(emails)].map(async (e) => { out.set(e, await checkAddress(e, r)); }));
  return out;
}

/** for tests: forget every domain */
export const forgetAddressChecks = (): void => cache.clear();
