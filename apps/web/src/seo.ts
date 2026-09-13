// Document metadata per screen. index.html carries the landing's tags for the crawlers that read
// raw HTML (social cards, most bots). This keeps the tab title, description, canonical URL and
// robots directive honest after a client-side navigation, for the crawlers that render. The
// static files in public/ (sitemap.xml, robots.txt, llms.txt) mirror this table, and seo.test.ts
// holds them together.
import type { Screen } from './shell';

export const SITE = 'https://www.neuramesh.app';
export const OG_IMAGE = `${SITE}/og-fast-to-done.png`;
export const ROBOTS_INDEX = 'index,follow,max-image-preview:large';
export const ROBOTS_NOINDEX = 'noindex,nofollow';

export type PageMeta = { path: string; title: string; description: string; index: boolean };

export const PAGE_META: Record<Screen, PageMeta> = {
  landing: { path: '/', title: 'neuramesh · From ask to done in minutes', description: 'Vetted expert agents on fast models finish marketing drafts, research reports, routines, and pull requests. Another agent checks it. You approve what goes out.', index: true },
  downloads: { path: '/downloads', title: 'Download neuramesh for Mac', description: 'The macOS app, signed and notarized by Apple. The whole product, free on your Mac, with your local repos and your own CLI logins.', index: true },
  pro: { path: '/pro', title: 'Get Pro · neuramesh', description: 'Pro is the hosted cloud around the free Mac app: a cloud machine for every member, invites, seats, and sync across devices. $22 per seat, per month.', index: true },
  'model-benchmarks': { path: '/model-benchmarks', title: 'Model benchmarks · neuramesh', description: 'Every model we tested, scored per agent role and weighed against list pricing. The per-role winners become the default brain packs.', index: true },
  support: { path: '/support', title: 'Support · neuramesh', description: 'Questions, bug reports, feature requests, and the FAQ. A human reads every message, usually within a day.', index: true },
  signup: { path: '/signup', title: 'Create your account · neuramesh', description: 'Create your account for Pro, the hosted cloud. $22 per seat, per month. The Mac app stays free.', index: true },
  terms: { path: '/terms', title: 'Terms of Service · neuramesh', description: 'The terms that govern your use of neuramesh: the workspace, the apps, and the cloud machines.', index: true },
  privacy: { path: '/privacy', title: 'Privacy Policy · neuramesh', description: 'What neuramesh stores, what stays on the machines you own, and how to reach us about your data.', index: true },
  join: { path: '/join', title: 'Join a workspace · neuramesh', description: 'Accept your invitation and join the workspace.', index: false },
  welcome: { path: '/welcome', title: 'Open your workspace · neuramesh', description: 'Your account is ready. Open your workspace in the browser, or add your Mac.', index: false },
  'billing-success': { path: '/billing/success', title: 'Billing · neuramesh', description: 'Your plan change went through.', index: false },
  'billing-cancel': { path: '/billing/cancel', title: 'Billing · neuramesh', description: 'Checkout was cancelled. Nothing changed.', index: false },
  'billing-portal': { path: '/billing/portal-return', title: 'Billing · neuramesh', description: 'You are back from the billing portal.', index: false },
  'desktop-signin': { path: '/desktop-signin', title: 'Sign in to the desktop app · neuramesh', description: 'Finish the sign-in in your browser, then return to the app.', index: false },
};

function upsert(selector: string, make: () => HTMLElement, attr: string, value: string): void {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) { el = make(); document.head.appendChild(el); }
  el.setAttribute(attr, value);
}

export function applyPageMeta(screen: Screen): void {
  if (typeof document === 'undefined') return;
  const m = PAGE_META[screen];
  document.title = m.title;
  upsert('meta[name="description"]', () => Object.assign(document.createElement('meta'), { name: 'description' }), 'content', m.description);
  upsert('meta[name="robots"]', () => Object.assign(document.createElement('meta'), { name: 'robots' }), 'content', m.index ? ROBOTS_INDEX : ROBOTS_NOINDEX);
  upsert('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), 'href', SITE + m.path);
}
