// THE PREVIEW CHECKS, IN THE MACHINE'S OWN BROWSER (coding-evals.mjs). scripts/coding-evals/preview.mjs
// drives the desktop's browser pane with CDP. On Cloud Run the person's browser pane is the relay's
// browser lane, which takes only pixel clicks and typed text. So the box serves the generated app on a
// loopback port (the dev-server preview path: only the Chromium in the box shares that loopback), and
// a probe page on the same origin loads the app in a frame and runs the SAME checks as preview.mjs
// against its DOM, with DOM events (a value set plus input and change, element.click()) in place of
// real input events. The probe posts its results to the server, and the driver reads them in the box.
//
// Exported as source text: previewServerSource() is written to the box, probePage(id) is served by it.

/** a static server for the worktree's public/ and src/ (preview.mjs serve), the probe page, and the
 *  probe's result post. Usage in the box: node server.mjs <worktree> <port> <resultFile> */
export function previewServerSource(probeHtmlByCase) {
  return `import { createServer } from 'node:http';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const [cwd, port, out, id] = process.argv.slice(2);
const base = await realpath(cwd);
const PROBES = ${JSON.stringify(probeHtmlByCase)};
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (path === '/__nm_probe') { res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' }); res.end(PROBES[id]); return; }
    if (path === '/__nm_result' && req.method === 'POST') {
      let body = ''; for await (const c of req) body += c;
      await writeFile(out, body); res.writeHead(204); res.end(); return;
    }
    if (path !== '/' && !/^\\/(public|src)\\/[\\w./-]+$/.test(path)) throw new Error('not a preview asset');
    const file = await realpath(resolve(base, path === '/' ? 'public/index.html' : path.slice(1)));
    if (!file.startsWith(base + sep)) throw new Error('outside the fixture');
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(file)];
    if (!type) throw new Error('not a preview asset');
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(port), '127.0.0.1', () => console.log('PREVIEW_READY ' + port));
`;
}

// the probe's helpers: the same element lookups as preview.mjs (labelledField, button by accessible
// name), on the frame's document
const HELPERS = `
const frame = document.getElementById('app');
const doc = () => frame.contentDocument;
const win = () => frame.contentWindow;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { checks: [], errors: [] };
const check = (name, yes) => results.checks.push({ name, passed: !!yes });
async function until(fn, ms = 15000) { const end = Date.now() + ms; for (;;) { try { const v = fn(); if (v) return v; } catch {} if (Date.now() > end) return null; await sleep(100); } }
async function waitHeading(h) { if (!await until(() => doc()?.querySelector('h1')?.textContent.includes(h))) throw new Error('heading ' + h + ' did not appear'); await sleep(300); }
function field(label) { const f = [...doc().querySelectorAll('input,textarea,select')].find((e) => e.getAttribute('aria-label') === label || [...(e.labels ?? [])].some((l) => l.textContent.trim() === label)); if (!f) throw new Error('no field ' + label); return f; }
const hasField = (label) => { try { field(label); return true; } catch { return false; } };
function button(label, partial = false) {
  const b = [...doc().querySelectorAll('button')].find((e) => { const copy = e.cloneNode(true); copy.querySelectorAll('[aria-hidden="true"],[hidden]').forEach((n) => n.remove()); const labelled = (e.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean).map((id) => doc().getElementById(id)?.textContent ?? '').join(' '); const name = (e.getAttribute('aria-label') ?? (labelled || copy.textContent)).trim().replace(/\\s+/g, ' '); return e.getClientRects().length && (partial ? name.includes(label) : name === label); });
  if (!b) throw new Error('no button ' + label); b.click();
}
function fill(el, value) {
  el.focus();
  const proto = el.tagName === 'TEXTAREA' ? win().HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? win().HTMLSelectElement.prototype : win().HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  el.dispatchEvent(new (win().Event)('input', { bubbles: true })); el.dispatchEvent(new (win().Event)('change', { bubbles: true }));
}
function selectLabel(el, label) { const o = [...el.options].find((x) => x.textContent.trim() === label); if (!o) throw new Error('no option ' + label); fill(el, o.value); }
const visibleAlert = () => [...doc().querySelectorAll('[role=alert]')].some((e) => e.getClientRects().length && win().getComputedStyle(e).visibility !== 'hidden' && e.textContent.trim());
const total = () => doc().querySelector('[data-testid=total]')?.textContent ?? '';
async function reload(h) { win().location.reload(); await sleep(300); await waitHeading(h); }
async function step(name, fn) { try { await fn(); } catch (e) { results.errors.push(name + ': ' + String(e && e.message || e)); check(name, false); } }
`;

const MEDIUM = `
await waitHeading('TaskGarden');
check('solution appears inside NeuraMesh browser', doc().querySelector('h1')?.textContent.includes('TaskGarden'));
await step('active filter hides completed tasks', async () => {
  fill(field('Task title'), 'Buy milk'); button('Add task', true); await sleep(200);
  fill(field('Task title'), 'Read book'); button('Add task', true); await sleep(200);
  field('Complete Buy milk').click(); await sleep(200);
  button('Active'); await sleep(200);
  check('active filter hides completed tasks', !hasField('Complete Buy milk') && hasField('Complete Read book'));
});
await step('completed filter shows completed task', async () => { button('Completed'); await sleep(200); check('completed filter shows completed task', hasField('Complete Buy milk') && !hasField('Complete Read book')); });
await step('empty task shows validation', async () => { button('All'); await sleep(200); fill(field('Task title'), '  '); button('Add task', true); await sleep(300); check('empty task shows validation', visibleAlert()); });
await step('app data persists across preview reload', async () => { await reload('TaskGarden'); check('app data persists across preview reload', doc().querySelectorAll('input[type=checkbox]').length === 2); });
check('preview has no horizontal overflow', doc().documentElement.scrollWidth <= win().innerWidth + 1);
`;

const COMPLEX = `
await waitHeading('LedgerDesk');
check('solution appears inside NeuraMesh browser', doc().querySelector('h1')?.textContent.includes('LedgerDesk'));
await step('exact money total shown', async () => { fill(field('Expense title'), 'Lunch'); fill(field('Amount'), '12.34'); fill(field('Category'), 'Food'); button('Add expense', true); await sleep(300); check('exact money total shown', total().includes('12.34')); });
await step('import adds to existing total', async () => { fill(field('Import JSON'), '[{"id":"book","title":"Book","amountCents":500,"category":"Study"}]'); button('Import'); await sleep(300); check('import adds to existing total', total().includes('17.34')); });
await step('successful import clears its input', async () => { check('successful import clears its input', field('Import JSON').value === ''); });
await step('export includes both existing and imported records', async () => { button('Export JSON'); await sleep(300); const rows = JSON.parse(field('Import JSON').value); check('export includes both existing and imported records', rows.length === 2 && rows.some((r) => r.title === 'Lunch' && r.amountCents === 1234) && rows.some((r) => r.id === 'book' && r.amountCents === 500)); });
let before = null;
await step('invalid import is atomic and visible', async () => { before = win().localStorage.getItem('ledgerdesk.state'); fill(field('Import JSON'), '[{"id":"book","title":"Duplicate","amountCents":100,"category":"Study"}]'); button('Import'); await sleep(300); check('invalid import is atomic and visible', total().includes('17.34') && visibleAlert()); });
await step('failed import leaves saved data unchanged', async () => { check('failed import leaves saved data unchanged', win().localStorage.getItem('ledgerdesk.state') === before); });
await step('category filter shows only matching entries', async () => { selectLabel(field('Filter category'), 'Study'); await sleep(300); const rows = doc().querySelectorAll('[data-expense-id]'); check('category filter shows only matching entries', rows.length === 1 && rows[0]?.textContent.includes('Book')); selectLabel(field('Filter category'), 'All'); await sleep(200); });
await step('invalid amount shows an error without changing totals', async () => { await reload('LedgerDesk'); fill(field('Expense title'), 'Invalid expense'); fill(field('Amount'), '-1'); fill(field('Category'), 'Food'); button('Add expense', true); await sleep(300); check('invalid amount shows an error without changing totals', total().includes('17.34') && visibleAlert()); });
await step('app data persists across preview reload', async () => { await reload('LedgerDesk'); check('app data persists across preview reload', total().includes('17.34')); });
check('preview has no horizontal overflow', doc().documentElement.scrollWidth <= win().innerWidth + 1);
const stored = win().localStorage.getItem('ledgerdesk.state');
await step('preview startup migrates version 1 records', async () => { win().localStorage.setItem('ledgerdesk.state', JSON.stringify({ version: 1, items: [{ id: 'legacy', title: 'Legacy trip', amount: 6.78, category: 'Travel' }] })); await reload('LedgerDesk'); check('preview startup migrates version 1 records', total().includes('6.78') && doc().querySelector('[data-expense-id=legacy]')?.textContent.includes('Legacy trip')); });
await step('corrupt saved data is reported and preserved', async () => { win().localStorage.setItem('ledgerdesk.state', '{broken legacy data'); await reload('LedgerDesk'); check('corrupt saved data is reported and preserved', win().localStorage.getItem('ledgerdesk.state') === '{broken legacy data' && visibleAlert()); });
win().localStorage.setItem('ledgerdesk.state', stored); await reload('LedgerDesk').catch(() => {});
`;

/** the probe page for a case: the app in a same-origin frame, the checks, the result post */
export function probePage(id) {
  const body = id === 'medium' ? MEDIUM : id === 'complex' ? COMPLEX : null;
  if (!body) return null;
  return `<!doctype html><html><head><meta charset="utf-8"><title>NM preview probe</title>
<style>html,body{margin:0;height:100%}#app{border:0;width:100%;height:100%}</style></head>
<body><iframe id="app" src="/"></iframe><script type="module">
${HELPERS}
try {
${body}
} catch (e) { results.errors.push(String(e && e.message || e)); }
document.title = 'NMPROBE done';
await fetch('/__nm_result', { method: 'POST', body: JSON.stringify(results) });
</script></body></html>`;
}
