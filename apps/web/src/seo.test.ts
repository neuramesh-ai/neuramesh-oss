// The SEO gate: the per-screen metadata, the static files in public/ and the head of index.html
// describe one site. Each file is hand-written, so this is what keeps them from drifting apart.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOSE, COMPUTE, CREW, EXPERTS, FAST, FOOTER, HERO, IN_EVERY_ROOM, LOOP, PRICING, PROOF, ROOMS, RULES, SURFACES } from './copy';
import { OG_IMAGE, PAGE_META, ROBOTS_INDEX, SITE } from './seo';

const pub = (name: string) => resolve(__dirname, '../public', name);
const read = (name: string) => readFileSync(pub(name), 'utf8');
const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
const attr = (tag: string, key: string, name: string) => html.match(new RegExp(`<${tag}[^>]*${key}="${name}"[^>]*content="([^"]*)"`))?.[1];
const pages = Object.values(PAGE_META);

describe('page meta', () => {
  it('fits the snippet and reads as STE', () => {
    for (const m of pages) {
      expect(m.title.length, m.path).toBeLessThanOrEqual(60);
      expect(m.description.length, m.path).toBeLessThanOrEqual(160);
      expect(m.title + m.description, m.path).not.toMatch(/—|;/);
      expect(m.path).toMatch(/^\//);
    }
  });
  it('is what index.html says about the landing page', () => {
    expect(html).toContain(`<title>${PAGE_META.landing.title}</title>`);
    expect(attr('meta', 'name', 'description')).toBe(PAGE_META.landing.description);
    expect(attr('meta', 'name', 'robots')).toBe(ROBOTS_INDEX);
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
  });
});

describe('social card', () => {
  it('points every card tag at one rendered image that exists', () => {
    expect(attr('meta', 'property', 'og:image')).toBe(OG_IMAGE);
    expect(attr('meta', 'name', 'twitter:image')).toBe(OG_IMAGE);
    expect(existsSync(pub(OG_IMAGE.slice(SITE.length + 1)))).toBe(true);
    expect(attr('meta', 'property', 'og:image:width')).toBe('1200');
    expect(attr('meta', 'property', 'og:image:height')).toBe('630');
    expect(attr('meta', 'name', 'twitter:card')).toBe('summary_large_image');
    for (const key of ['og:image:alt', 'og:description', 'og:title']) expect(attr('meta', 'property', key), key).toBeTruthy();
    for (const key of ['twitter:image:alt', 'twitter:description', 'twitter:title']) expect(attr('meta', 'name', key), key).toBeTruthy();
  });
  it('ships the icons the head and the manifest name', () => {
    for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'qr-appstore.svg']) expect(existsSync(pub(f)), f).toBe(true);
    const manifest = JSON.parse(read('site.webmanifest')) as { icons: Array<{ src: string }> };
    for (const i of manifest.icons) expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />');
  });
  it('carries structured data that parses', () => {
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as { '@graph': Array<{ '@type': string }> });
    expect(blocks.length).toBe(1);
    expect(blocks[0]!['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication']);
  });
  it('offers the two plans at the prices the pricing section shows', () => {
    const block = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]!) as { '@graph': Array<{ '@type': string; offers?: Array<{ name: string; price: string; priceCurrency: string; description: string }> }> };
    const offers = block['@graph'].find((n) => n['@type'] === 'SoftwareApplication')!.offers!;
    expect(offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual(PRICING.plans.map((p) => [p.name, p.price.replace('$', ''), 'USD']));
    for (const o of offers) expect(o.description).not.toMatch(/—|;|\bIndividual\b|\bTeam\b|500 credits|at signup/);
  });
});

describe('sitemap and robots', () => {
  const sitemap = read('sitemap.xml');
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const disallow = [...read('robots.txt').matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]!);
  it('lists exactly the indexable screens', () => {
    expect(new Set(locs)).toEqual(new Set(pages.filter((m) => m.index).map((m) => SITE + m.path)));
  });
  it('keeps the noindex screens out of the crawl and the crawl out of the rest', () => {
    for (const m of pages) {
      const blocked = disallow.some((d) => m.path.startsWith(d));
      expect(blocked, m.path).toBe(!m.index);
    }
    expect(read('robots.txt')).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });
});

describe('llms.txt', () => {
  const short = read('llms.txt');
  const full = read('llms-full.txt');
  const vendorModel = /gemini\s*(3\.5\s*)?flash|flash[\s-]?lite|gpt-?\d|claude-\d|sonnet|opus|haiku/i;
  it('reads as STE and names only the house brain', () => {
    for (const t of [short, full]) {
      expect(t).not.toMatch(/—|;/);
      expect(t).not.toMatch(vendorModel);
      expect(t).toContain(PROOF.house);
      expect(t).toContain(SITE);
    }
  });
  it('states the plans as the pricing section does', () => {
    for (const p of PRICING.plans) expect(short).toContain(`${p.name}: ${p.price}`);
    for (const f of HERO.facts) expect(short.toLowerCase()).toContain(f.toLowerCase());
    for (const t of [short, full]) {
      expect(t).toContain(FOOTER.source.line);
      expect(t).toContain(FOOTER.source.url);
      expect(t).not.toMatch(/\bIndividual\b|\bTeam\b|500 credits|No install|open[\s-]source/);
    }
  });
  it('carries the landing copy verbatim in llms-full.txt', () => {
    const lines = [
      HERO.kicker, HERO.headline.join(' '), HERO.lead, PROOF.line, FAST.lead, EXPERTS.lead, EXPERTS.note, ROOMS.lead, LOOP.lead, CREW.lead, CREW.hire,
      RULES.lead, ...RULES.list, SURFACES.lead, SURFACES.anchor.body, COMPUTE.lead, PRICING.lead, CLOSE.line,
      ...[...FAST.cells, ...ROOMS.cells, ...LOOP.cells, ...COMPUTE.cells].map((c) => `${c.title}: ${c.body}`),
      ...EXPERTS.cards.map((c) => `${c.title}: ${c.body}`),
      ...IN_EVERY_ROOM.items.map((c) => `${c.title}: ${c.body}`),
      ...SURFACES.cards.map((c) => `${c.title}: ${c.body}`),
      ...CREW.roster.map((m) => `${m.name}: ${m.role}`),
      ...PRICING.plans.flatMap((p) => p.feats),
    ];
    for (const l of lines) expect(full, l).toContain(l);
  });
});
