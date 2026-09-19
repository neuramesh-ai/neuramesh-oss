// `pnpm mail:preview` — renders every shipped template to a browsable index (docs/27 §4).
//
// This imports the SAME functions the control-api sends with, so what you see here is what
// lands in an inbox, byte for byte.
//
// Output: .nm-evidence/email/ (git-excluded). Serve it, don't open with file://: Chrome
// treats file:// iframes as opaque origins and the height measurement silently fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderDay7, renderDigest, renderMarketing, renderPublishFailed, TEMPLATE_META, type RenderedEmail } from '../src/email/templates';
import { renderDay1, renderDay3, renderWelcome } from '../src/email/templates-lifecycle';
import { renderInvite, renderJoined } from '../src/email/templates-account';
import { renderHostedFreeNotice } from '../src/email/templates-notice';
import { renderAnnounceReady } from '../src/email/templates-announce';

const APP = 'https://neuramesh.app';        // user-facing: /join, /downloads, /billing
const API = 'https://api.neuramesh.app';    // the unsubscribe route lives on the control-api
const unsub = `${API}/u/demo.token`;

const SAMPLES: Array<{ key: string; email: RenderedEmail }> = [
  { key: 'invite', email: renderInvite({ inviter: 'George', inviterEmail: 'george@neuramesh.app', workspace: 'Flowe', role: 'Member', acceptUrl: `${APP}/join?token=demo` }) },
  { key: 'joined', email: renderJoined({ joinedEmail: 'ada@flowe.dev', workspace: 'Flowe', role: 'Member', seatLine: '2 of 3 · free plan', settingsUrl: `${APP}/downloads` }) },
  // the `error` here stands in for a provider's verbatim message. We quote those as-is, so it
  // is the one string in an email we never rewrite for house style.
  { key: 'publishFailed', email: renderPublishFailed({ platform: 'X', slot: '09:00 today', error: '401 Unauthorized: token expired', queuedBehind: 2, reconnectUrl: `${APP}/downloads` }) },
  { key: 'announceReady', email: renderAnnounceReady({ repo: 'neuramesh-ai/neuramesh-oss', tag: 'v0.134.0', title: 'The browser terminal', networks: ['x', 'linkedin', 'instagram'], site: 'https://neuramesh.app', link: `${APP}/announce/demo`, verdict: 'feature' }) },
  { key: 'welcome', email: renderWelcome({ downloadUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
  { key: 'day1', email: renderDay1({ openUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
  { key: 'day3', email: renderDay3({ lesson: "This repo's tests never mock the database. Use the pg fixture in test/helpers.", taskNumber: 1042, channel: 'dev', reviewer: 'scout', worker: 'patch', statAccepted: 4, statReviews: 11, statLessons: 6, window: 'your first week', openUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
  { key: 'marketing', email: renderMarketing({ shippedThing: 'the CSV export', worker: 'patch', reviewer: 'scout', openUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
  { key: 'day7', email: renderDay7({ seatsUsed: 2, seatCap: 3, billingUrl: `${APP}/billing`, downloadUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
  { key: 'hostedFreeNotice', email: renderHostedFreeNotice({ workspaces: ['Flowe', 'Side Quest'], effectiveDate: '2026-09-29', proUrl: `${APP}/pro`, termsUrl: `${APP}/terms`, exportPath: 'GET /v1/workspaces/<workspace id>/export' }) },
  { key: 'digest', email: renderDigest({ channel: 'marketing', published: 3, waiting: 2, failed: 1, drafted: 6, window: '14–20 July', openUrl: `${APP}/downloads`, unsubscribeUrl: unsub }) },
];

const out = join(process.cwd(), '.nm-evidence', 'email');
mkdirSync(out, { recursive: true });

for (const { key, email } of SAMPLES) {
  writeFileSync(join(out, `${key}.html`), email.html);
  writeFileSync(join(out, `${key}.txt`), email.text);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const index = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>NeuraMesh email · rendered from shipped templates</title>
<style>
 :root{color-scheme:light dark;--ink:#38332d;--paper:#f4f2ed;--surface:#fbfaf7;--surface2:#f0eee8;--line:#e7e2da;--line2:#d6cfc4;--muted:#8a847a;--body:#585249;--green:#2f9e6b}
 @media(prefers-color-scheme:dark){:root{--ink:#d9d5ce;--paper:#1b1a18;--surface:#201f1c;--surface2:#272522;--line:#2a2825;--line2:#383530;--muted:#8f8a82;--body:#b7b4ac;--green:#77ac8d}}
 *{margin:0;padding:0;box-sizing:border-box}
 body{background:var(--paper);color:var(--ink);font-family:'Geist',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
 button{font:inherit;color:inherit;background:none;border:none;cursor:pointer}
 .top{display:flex;align-items:center;gap:13px;padding:15px 22px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--paper);z-index:5;flex-wrap:wrap}
 .brand{font-weight:800;letter-spacing:-.025em;display:flex;align-items:center;gap:8px}
 .tile{width:20px;height:20px;border-radius:6px;background:var(--ink);color:var(--paper);display:grid;place-items:center;font-size:11px;font-weight:800}
 .sub{color:var(--muted);font-size:13px}
 .spacer{flex:1}
 .seg{display:inline-flex;border:1px solid var(--line2);border-radius:999px;overflow:hidden}
 .seg button{padding:6px 13px;font-size:12.5px;font-weight:600;color:var(--muted)}
 .seg button[aria-pressed=true]{background:var(--ink);color:var(--paper)}
 .wrap{display:grid;grid-template-columns:230px 1fr;min-height:calc(100vh - 56px)}
 .rail{border-right:1px solid var(--line);padding:14px 12px 40px}
 .item{display:block;width:100%;text-align:left;padding:9px 11px;border-radius:9px;margin-bottom:2px}
 .item:hover{background:var(--surface2)}
 .item[aria-current=true]{background:var(--ink);color:var(--paper)}
 .iname{font-size:13.5px;font-weight:650}
 .isub{font-size:11px;opacity:.62;margin-top:2px;font-family:'Geist Mono',ui-monospace,Menlo,monospace}
 .stage{padding:22px 26px 60px;min-width:0}
 .meta{max-width:760px;margin:0 auto 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
 .mrow{display:grid;grid-template-columns:88px 1fr;gap:12px;padding:8px 15px;font-size:13px;border-bottom:1px solid var(--line)}
 .mrow:last-child{border-bottom:0}
 .mk{color:var(--muted);font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding-top:2px}
 .frame{max-width:760px;margin:0 auto;border:1px solid var(--line);border-radius:12px;background:var(--surface2);overflow:hidden}
 .fbody{display:flex;justify-content:center}
 iframe{border:0;width:100%;display:block;background:transparent}
 .note{max-width:760px;margin:0 auto 14px;border:1px solid var(--line2);border-left:3px solid var(--green);border-radius:10px;background:var(--surface);padding:11px 15px;font-size:13px;color:var(--body);line-height:1.55}
 .note b{color:var(--ink)}
</style></head><body>
<div class="top">
  <div class="brand"><span class="tile">N</span>NeuraMesh</div><span class="sub">Email · rendered from the shipped templates</span>
  <span class="spacer"></span>
  <div class="seg" id="th"><button data-t="light" aria-pressed="true">Light</button><button data-t="dark" aria-pressed="false">Dark</button></div>
  <div class="seg" id="wd"><button data-w="640" aria-pressed="true">Desktop</button><button data-w="390" aria-pressed="false">Mobile</button></div>
</div>
<div class="wrap"><nav class="rail" id="rail"></nav><main class="stage">
  <div class="note"><b>These are production renders.</b> Generated by <code>packages/shared/src/email/templates.ts</code>, the same functions <code>control-api</code> hands to Resend, so this is byte-for-byte what arrives in an inbox.</div>
  <div class="meta" id="meta"></div>
  <div class="frame"><div class="fbody"><iframe id="pane" title="Email preview"></iframe></div></div>
</main></div>
<script>
const DATA = ${JSON.stringify(SAMPLES.map(({ key, email }) => ({
  key, subject: email.subject, preheader: email.preheader, html: email.html,
  kind: TEMPLATE_META[key]?.kind ?? '', shape: TEMPLATE_META[key]?.shape ?? '',
})))};
let cur = 0, theme = 'light', width = 640;
const rail = document.getElementById('rail'), pane = document.getElementById('pane'), meta = document.getElementById('meta');
function draw() {
  rail.innerHTML = DATA.map((d, i) => \`<button class="item" data-i="\${i}" aria-current="\${i === cur}"><div class="iname">\${d.key}</div><div class="isub">\${d.kind}</div></button>\`).join('');
  rail.querySelectorAll('.item').forEach((b) => b.addEventListener('click', () => { cur = +b.dataset.i; draw(); }));
  const d = DATA[cur];
  meta.innerHTML = \`<div class="mrow"><div class="mk">Subject</div><div><b>\${d.subject.replace(/</g,'&lt;')}</b></div></div>
    <div class="mrow"><div class="mk">Preheader</div><div>\${d.preheader.replace(/</g,'&lt;')}</div></div>
    <div class="mrow"><div class="mk">Shape</div><div>\${d.shape.replace(/</g,'&lt;')}</div></div>\`;
  pane.srcdoc = theme === 'dark'
    ? d.html.replace('<meta name="color-scheme" content="light dark">', '<meta name="color-scheme" content="dark">').replace(/@media \\(prefers-color-scheme: dark\\)/g, '@media all')
    : d.html;
  pane.style.maxWidth = width + 'px';
  pane.style.colorScheme = theme;
}
pane.addEventListener('load', () => { try { pane.style.height = Math.max(420, pane.contentDocument.documentElement.scrollHeight) + 'px'; } catch { pane.style.height = '900px'; } });
document.getElementById('th').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; theme = b.dataset.t; [...e.currentTarget.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b))); draw(); });
document.getElementById('wd').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; width = +b.dataset.w; [...e.currentTarget.children].forEach((c) => c.setAttribute('aria-pressed', String(c === b))); draw(); });
draw();
</script></body></html>`;

writeFileSync(join(out, 'index.html'), index);
console.log(`rendered ${SAMPLES.length} templates -> ${out}/index.html`);
for (const { key, email } of SAMPLES) console.log(`  ${key.padEnd(15)} ${esc(email.subject)}`);
