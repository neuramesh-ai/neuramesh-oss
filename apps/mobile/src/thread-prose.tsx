// The thread's prose renderer — markdown-ish message bodies, the card markers stripped out,
// and link prettying. Split out of src/thread.tsx (track D).

import { type Theme } from '@neuramesh/client-core';



import { type ReactNode } from 'react';
import { Text } from 'react-native';
import { F } from './type';





export function stripCards(body: string): string {
  return body.replace(/```nm[a-z]+\s*\n[\s\S]*?```/g, '').trim();
}

// Render message prose. Markdown links `[label](url)` and bare `https://…` URLs (the PR links
// agents post) open in an in-app browser and render in the blue accent + underline, so an
// external link is obviously tappable. `**bold**` spans, `#123` task refs, and artifact
// filenames (implementation-plan-v1.md, design-mockup-v1-…) navigate in-app. Parity with the
// desktop's linkifiers; everything else stays plain text.
export function renderProse(
  body: string,
  taskByNumber: Map<number, string>,
  artifactByName: Map<string, string>,
  onTask: (id: string) => void,
  onArtifact: (id: string) => void,
  onUrl: (url: string) => void,
  t: Theme,
): ReactNode[] {
  const out: ReactNode[] = [];
  // Split on markdown links / bare URLs FIRST so a stray `**` can never fracture a URL; then run
  // the existing bold + #ref + artifact linkifier over the plain-text chunks between them.
  body.split(/(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g).forEach((chunk, ci) => {
    if (!chunk) return;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(chunk);
    if (link || /^https?:\/\/[^\s)]+$/.test(chunk)) {
      const url = link ? link[2] : chunk;
      out.push(
        <Text key={`u${ci}`} onPress={() => onUrl(url)} suppressHighlighting style={{ color: t.link, textDecorationLine: 'underline', textDecorationColor: t.link }}>
          {link ? link[1] : prettyUrl(chunk)}
        </Text>,
      );
      return;
    }
    chunk.split(/\*\*/).forEach((seg, i) => {
      const bold = i % 2 === 1;
      seg.split(/(#\d+\b|implementation-plan(?:-v\d+)?\.md|design-mockup-v\d+-[\w-]+)/g).forEach((part, j) => {
        if (!part) return;
        const key = `${ci}.${i}.${j}`;
        const m = /^#(\d+)$/.exec(part);
        const taskId = m ? taskByNumber.get(Number(m[1])) : undefined;
        const artifactId = artifactByName.get(part);
        if (taskId) {
          // Mirror the desktop's .taskref affordance — bold + a dotted underline says "tap me"
          // in every theme even where the accent tone is quiet. Dotted = internal task nav.
          out.push(
            <Text
              key={key}
              onPress={() => onTask(taskId)}
              suppressHighlighting
              style={{ ...F.body(600), color: t.link, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: t.link }}
            >
              {part}
            </Text>,
          );
        } else if (artifactId) {
          out.push(
            <Text key={key} onPress={() => onArtifact(artifactId)} suppressHighlighting style={{ ...F.body(600), color: t.link, textDecorationLine: 'underline', textDecorationColor: t.link }}>
              {part}
            </Text>,
          );
        } else {
          out.push(
            <Text key={key} style={bold ? F.body(600) : undefined}>
              {part}
            </Text>,
          );
        }
      });
    });
  });
  return out;
}

// Bare URLs render as host+path (protocol/www stripped, capped) so a long link doesn't overrun
// the bubble; markdown links keep their author-given label instead.
export function prettyUrl(u: string): string {
  const s = u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  return s.length > 42 ? `${s.slice(0, 40)}…` : s;
}
