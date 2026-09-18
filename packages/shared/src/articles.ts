// ARTICLE DELIVERABLES (docs/design/article-deliverables-2026-08) — the pure half.
//
// An article IS a doc artifact; these are the two things every surface must agree on:
// the ‹article:id› marker that turns a message into the card, and the derivation that
// turns the artifact's markdown into the card's fields. Pure on purpose — the thread
// card, the Files preview and the reading tab render from ONE parse, so they cannot
// disagree about what the article says it is (the postCardsFrom rule, one type over).

export interface ArticleRef {
  id: string;
  /** the message text around the marker — prose stays prose, the marker becomes the card */
  prose: string;
}

/** `‹article:artifactId›` — one per message (the first wins), same anatomy as ‹wb:id›. */
export function parseArticleRef(body: string): ArticleRef | null {
  const m = /‹article:([^‹›\s]+)›/.exec(body);
  if (!m) return null;
  return { id: m[1]!, prose: body.replace(/‹article:[^‹›]*›/g, '').trim() };
}

export interface ArticleMeta {
  /** first `# ` heading, else the artifact name without its extension */
  title: string;
  /** the first real paragraph after the title — the card's two-line dek */
  dek: string;
  /** the first image's src — the card's hero (renderers decide what is displayable) */
  hero: string | null;
  words: number;
  /** ceil(words / 200) and never 0 — "1 min read" is the honest floor */
  minutes: number;
  /** entries under a `## Sources` / `## References` heading (list items or links) */
  sources: number;
  images: number;
}

// the alt text stops at a bracket and the target at a parenthesis, so a run of openers is scanned
// once, not once per opener (CodeQL js/polynomial-redos, 2026-09-18)
const IMG_RE = /!\[[^[\]]*\]\(([^()\s]+)[^()]*\)/g;

export function articleFrom(name: string, markdown: string): ArticleMeta {
  const md = markdown.trim();
  const title = /^#[ \t]+(\S.*)$/m.exec(md)?.[1]?.trim() ?? name.replace(/\.(md|markdown|txt)$/i, '');

  // the dek: the first paragraph that is content — not a heading, list, image, code fence or table
  const afterTitle = md.replace(/^#[ \t]+\S.*$/m, '');
  let dek = '';
  let inFence = false;
  for (const block of afterTitle.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b) continue;
    if (b.startsWith('```')) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|!\[|\||>)/.test(b)) continue;
    dek = b.replace(/\s+/g, ' ')
      .replace(/!\[[^[\]]*\]\([^()]*\)/g, '')
      .replace(/\[([^[\]]+)\]\([^()]*\)/g, '$1')
      .replace(/[*_`]/g, '')
      .trim();
    if (dek) break;
  }

  const hero = new RegExp(IMG_RE.source).exec(md)?.[1] ?? null;
  const images = (md.match(IMG_RE) ?? []).length;

  // words: prose only — code fences, image lines, link targets and md syntax marks would
  // inflate the honest count
  const prose = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^[\]]*\]\([^()]*\)/g, ' ')
    .replace(/\[([^[\]]+)\]\([^()]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
  const words = (prose.match(/\S+/g) ?? []).length;
  const minutes = Math.max(1, Math.ceil(words / 200));

  // sources: the section a citable article carries — count its list rows (or bare link lines)
  let sources = 0;
  const src = /^#{2,3}\s+(sources|references|citations)\s*$/im.exec(md);
  if (src) {
    const tail = md.slice(src.index + src[0].length);
    const section = tail.split(/\n#{1,6}\s/)[0] ?? '';
    sources = (section.match(/^\s*(?:[-*+]|\d+[.)]|\[\d+\])\s+\S/gm) ?? []).length
      || (section.match(/https?:\/\//g) ?? []).length;
  }

  return { title, dek, hero, words, minutes, sources, images };
}

/** The card's facts line — one composer so every surface words it identically. */
export function articleFacts(a: ArticleMeta): string {
  const parts = [`${a.minutes} min read`, `${a.words.toLocaleString('en-US')} words`];
  if (a.sources > 0) parts.push(`${a.sources} source${a.sources === 1 ? '' : 's'}`);
  if (a.images > 0) parts.push(`${a.images} image${a.images === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
