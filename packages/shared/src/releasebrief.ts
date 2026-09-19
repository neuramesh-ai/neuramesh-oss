// The release brief (docs/design/release-drafts-2026-09 §4.4): the deliverable a release run
// writes beside its posts. The articles/reports pattern, applied again: the brief IS a markdown
// artifact, this module reads its shape back out, and a `‹brief:id›` marker in a message is what
// the ReleaseCard renders from. The head is the contract: line one `# Release brief · <tag>`, a
// `Verdict:` line within the first five, and the honesty section at the end.
import { markerSpans, stripMarkers, trimLineEnds } from './linear';
export type ReleaseVerdict = 'feature' | 'improvement' | 'fix' | 'none';
export interface ReleaseBrief {
  tag: string;
  /** the feature's own title: the first `## Why` sentence, else the head's tag */
  title: string;
  verdict: ReleaseVerdict;
  basis: string | null;
  why: string;
  audience: string;
  assets: string;
  gaps: string;
  /** pull requests named in the why, by number */
  prs: number[];
}

const HEAD_RE = /^#\s+Release (?:brief|announcement|drafts)\s*[·:-]\s*(\S[^\n]*)$/im;
const VERDICT_RE = /verdict:\s*(feature|improvement|fix|none)\b/i;
const VERDICTS: ReleaseVerdict[] = ['feature', 'improvement', 'fix', 'none'];

function section(md: string, head: RegExp): string {
  const m = head.exec(md);
  if (!m) return '';
  const rest = md.slice(m.index + m[0].length);
  const next = /^#{1,3}\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** null when the markdown is not a release brief: the head, the verdict line, the gaps section */
export function releaseBriefFrom(name: string, markdown: string | null | undefined): ReleaseBrief | null {
  const md = (markdown ?? '').replace(/\r/g, '');
  if (!/\.md$/i.test(name)) return null;
  const head = HEAD_RE.exec(md);
  if (!head) return null;
  const top = md.split('\n').slice(0, 5).join('\n');
  const v = VERDICT_RE.exec(top);
  if (!v) return null;
  const verdict = v[1]!.toLowerCase() as ReleaseVerdict;
  if (!VERDICTS.includes(verdict)) return null;
  const gapsHead = /^#{2,3}\s+what\s+i\s+(?:could\s+not|couldn[’']?t)\s+determine\s*$/im;
  if (!gapsHead.test(md)) return null;
  const basis = /basis:\s*([^\n]+)/i.exec(top)?.[1]?.replace(/\s*·\s*$/, '').trim() ?? null;
  const why = section(md, /^#{2,3}\s+why\s*$/im);
  // the headline is the why's first SENTENCE: an agent writes the why as one paragraph as often as
  // one line per thought (live harness, 2026-09-18), and a paragraph is not a title. A period ends a
  // sentence only before a space or the end, so `v0.134.0` stays whole.
  const firstLine = (/^#{2,3}\s+(?:the\s+)?feature\s*$/im.test(md) ? section(md, /^#{2,3}\s+(?:the\s+)?feature\s*$/im) : why).split(/\n/)[0]?.replace(/^[-*]\s*/, '').trim() ?? '';
  const stop = firstLine.search(/[.!?](?=\s|$)/);
  const title = (stop > 20 ? firstLine.slice(0, stop + 1) : firstLine) || head[1]!.trim();
  const prs = [...why.matchAll(/#(\d{1,6})\b/g)].map((m) => Number(m[1])).filter((n, i, a) => a.indexOf(n) === i);
  return {
    tag: head[1]!.trim(),
    title: title.length > 160 ? `${title.slice(0, 159).trimEnd()}…` : title,
    verdict,
    basis,
    why,
    audience: section(md, /^#{2,3}\s+audience\s*$/im),
    assets: section(md, /^#{2,3}\s+assets\s*$/im),
    gaps: section(md, gapsHead),
    prs,
  };
}

/** the why without the sentence the title already says: releaseBriefFrom lifts the why's first
 *  sentence as the title, whether it stands alone on its line or opens a paragraph. One rule for the
 *  desktop card and the public page (the ready page repeated the headline, live, 2026-09-18). */
export function whyBelowTitle(b: Pick<ReleaseBrief, 'title' | 'why'>): string {
  const lines = b.why.split('\n');
  const first = (lines[0] ?? '').replace(/^[-*]\s*/, '').trim();
  const rest = first === b.title ? lines.slice(1) : first.startsWith(b.title) ? [first.slice(b.title.length).trim(), ...lines.slice(1)] : lines;
  return rest.join('\n').replace(/^\n+/, '').trim();
}

/** `‹brief:<artifact id>›`: the card marker (the tick's `‹release:owner/repo@tag›` is another marker) */
export function briefMarker(artifactId: string): string {
  return `‹brief:${artifactId}›`;
}
export interface BriefRef { id: string; prose: string }
export function parseBriefRef(body: string | null | undefined): BriefRef | null {
  const text = body ?? '';
  // the marker by index (a body of many `‹brief:` costs the input once), the id checked in place
  const hit = markerSpans(text, '‹brief:', '›').find((sp) => sp.inner.length === 36 && /^[0-9a-fA-F-]{36}$/.test(sp.inner));
  if (!hit) return null;
  return { id: hit.inner.toLowerCase(), prose: trimLineEnds(stripMarkers(text, '‹brief:', '›')).replace(/\n{3,}/g, '\n\n').trim() };
}
