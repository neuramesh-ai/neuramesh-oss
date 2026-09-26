import type { HtmlTagDescriptor, Plugin } from 'vite';

// THE FIRST SCREEN'S FONTS, asked for with the page. A font is only fetched once text that uses it
// is laid out, and in this app that is after the entry chunk, the App chunk and the first render:
// measured ~1.8 s into a cold fast4g load, so the shell painted in fallback fonts and then swapped.
// The three latin files the first screen draws with are preloaded; the other subsets stay on demand.
const FIRST_SCREEN = /(^|\/)(neuramesh-sans|bricolage-grotesque|geist-mono)-latin-wght-normal-[\w-]+\.woff2$/;

export function fontPreloads(): Plugin {
  return {
    name: 'nm-font-preloads',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        const tags: HtmlTagDescriptor[] = [];
        for (const f of Object.keys(ctx.bundle)) {
          if (FIRST_SCREEN.test(f)) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `/${f}` }, injectTo: 'head' });
        }
        return tags;
      },
    },
  };
}
