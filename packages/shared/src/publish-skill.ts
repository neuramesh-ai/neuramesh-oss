/** The `publish-page` skill (docs/design/inbox-sales-2026-11/plan.md I14, I15): how an agent makes a page or a file
 *  that people outside the workspace open on neuramesh.page, and how it publishes it. It rides the neuramesh-work
 *  pack in every room. The rules about the sandbox are the pages service's own (packages/pages/src/headers.ts,
 *  PAGE_CSP): a change there changes this text in the same PR. */
export const PUBLISH_PAGE_SKILL = `Make a page or a file that people outside the workspace open with a link on neuramesh.page, and publish it the right way.

This skill helps you make a page. You do not need it to publish a file that is in Files already: call publish_file with the file's id.

## When you publish, and when you ask
- The person asked you in this conversation to publish (or to "share it", "put it online", "give me a link"): call publish_file with the file's id. The server checks that a person typed here in the last 30 minutes.
- The person did not ask: call ask_publish. It posts a card, and only the person selects Publish. A finished page is not a request to publish it.
- After publish_file, give the person the exact link the tool returned. Never invent a link and never guess a token. Say that anyone with the link can open it, and that they can remove it on the card or in Files.
- A file that has a link already and changed since: call ask_publish. Only the person moves a link to a new version (Update on the card).
- If a tool refuses, say why in one line and do the next move it names. Never try another route to make a file public.
- Publishing works on the hosted Cloud plan. On a Local connection or the free plan the tools refuse: say so, and give the file instead.

## What can go out
- A page: one self-contained HTML file, at most 5 MB.
- A video: MP4 (H.264 and AAC plays everywhere) or WebM, at most 200 MB.
- An image: PNG, JPEG, WebP or GIF, at most 200 MB. A GIF for email: under 2 MB and 600 px wide.
- Never SVG or PDF as the file. An SVG inside an HTML page is fine.
- The file can be in Files in any room you are in. Name it by its id: list_library shows the id, and scope project or workspace shows the files of other rooms. A file you write in this conversation goes to Files in this room.
- A file in Files goes out as it is. Call publish_file with its id, and do not read it or copy it first. The server holds the bytes. Read a file only to make a NEW page from it, for example from a Markdown document.
- A file in Files is not in the repository. Do not look for it there.
- The link's title comes from the file name, so name the file in words: q4-investor-update.html, field-sync-demo.mp4, never output-final-2.html.
- A file that only a desktop holds has no copy on the server, and the tools refuse it. Read it, save the full file to Files with the same name, and publish that copy.

## From a Markdown document
A Markdown or text file cannot go out as it is. When the person asks for a page from one:
- Read the whole document (read_library_doc). Keep its facts, its numbers and its order, and add no claim that it does not make.
- Make one self-contained HTML page from it with the rules below: the project's real brand, the sandbox, light and dark, and phone width. Each heading becomes a section, a table stays a table, and a chart replaces numbers only when the chart is clearer.
- Name the page as the document, with .html (implementation-plan.md gives implementation-plan.html), and save it to Files.
- Check it as "Check before you publish" says. Then call publish_file if the person asked, or ask_publish if not.

## How a published page runs (the sandbox)
The page is served with a strict Content Security Policy. Build for it, or the page breaks for every reader:
- Scripts run only inline, in <script> tags in the file. A <script src> never loads, so no CDN library (no Chart.js, no Tailwind CDN, no React from unpkg). Write small vanilla JavaScript, or none.
- The page cannot call out: no fetch, no XMLHttpRequest, no WebSocket, no EventSource, no form that posts, no iframe, no external image. Put every byte of data in the file.
- The page has no storage: localStorage, sessionStorage, cookies and IndexedDB throw. Keep state in memory, and wrap any storage read in try/catch.
- Styles go in <style> in the file. Fonts load only from Google Fonts (a <link> to fonts.googleapis.com), and always name a system fallback.
- Images and audio or video inside the page are data: URLs or inline <svg>. Compress them first: a 5 MB page loads slowly on a phone. For a real video, publish the MP4 itself and link to it.
- A link to another site opens in a new tab: target="_blank" rel="noopener noreferrer".
- Never put a secret in a page: no API key, token, password, connection string, private email or internal URL. A scan blocks a value like a key, and the person then sees the line.

## Make it beautiful
Start from the reader. One page has one job: say it in the headline, and put the strongest fact, number or picture first.
- **Content first.** Read the room's brand and business documents (list_library, read_library_doc) and use the company's name, voice, colors and real facts. Never lorem ipsum, invented numbers, invented quotes, fake logos or fake testimonials. A number on the page has a source the person can check.
- **Type.** At most two families: one display face for headlines and one text face, or a good system stack (system-ui, -apple-system, "Segoe UI", sans-serif). Body text 16 to 18 px, line height 1.5 to 1.65, lines of 60 to 75 characters. Use a clear scale (for example 14, 16, 20, 28, 40, 56 px) and tight line height on large headlines.
- **Color.** Define tokens on :root (--bg, --surface, --text, --muted, --accent, --border) and redefine them under @media (prefers-color-scheme: dark), so the page works in light and dark. One accent color. Text contrast at least 4.5:1, and 3:1 for large text and controls.
- **Layout.** Mobile first. The page works at 360 px wide with no sideways scroll, and on a wide screen it holds a max width (about 1100 px for a landing page, 720 px for reading). Use CSS grid and flex, a spacing scale on 4 or 8 px, generous white space, and images that shrink to fit (max-width 100%, height auto). Section by section: a hero, the proof, the detail, one clear call to action.
- **Detail.** Soft radii and shadows used the same way everywhere, hairline borders, real icons as inline SVG, tabular numbers (font-variant-numeric: tabular-nums) in tables and figures.
- **Charts.** Draw them as inline SVG from the real data, with labeled axes, units and a source line. Colors that read in both themes. No chart library.
- **Motion.** Small and quick (150 to 250 ms), only where it helps, and none under @media (prefers-reduced-motion: reduce).
- **Access.** <html lang>, a <title> and a meta description, <meta name="viewport" content="width=device-width, initial-scale=1">, one h1 and headings in order, alt text on each image, visible focus styles, and buttons that are <button>.

A start for the head:
\`\`\`html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Q4 update: Acme Robotics</title>
<meta name="description" content="Revenue, customers and the plan for Q1.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { --bg: #fbfaf7; --surface: #ffffff; --text: #1d1b18; --muted: #6b655c; --accent: #c2622d; --border: #e7e2d9; }
  @media (prefers-color-scheme: dark) { :root { --bg: #151412; --surface: #1d1b19; --text: #f1ede6; --muted: #a39b90; --accent: #e08a52; --border: #2e2b27; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.6 Inter, system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 48px 20px; }
</style>
</head>
\`\`\`

## Check before you publish
- Read every word on the page once more. Check each number against its source.
- Check that the page has no <script src>, no fetch or other call out, no form that posts, no storage without try/catch, and no secret.
- If you can open a browser, look at the page at 390 px and at 1280 px, in light and dark, and fix what overflows or breaks.
- For a video or image: the file opens, it plays or shows, and it is within the limits above.
- Then publish_file (the person asked) or ask_publish (the person did not), with one line on what the link is for.`;
