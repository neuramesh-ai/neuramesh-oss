#!/usr/bin/env node
// Create the NeuraMesh GitHub App from a manifest (docs/design/release-drafts-2026-09/plan.md §4.8).
//
// GitHub creates an App only through its own form: a browser POSTs a manifest to
// github.com/organizations/<org>/settings/apps/new, a person presses "Create GitHub App", and GitHub
// redirects to our redirect_url with a one-time code. This script serves that form at / and, on
// /callback, converts the code with the machine's own `gh` (POST /app-manifests/{code}/conversions),
// which answers with the App's id, slug, private key, client secret and webhook secret.
//
// Secrets never enter the repository: they land in .nm-evidence/github-app/ (gitignored) as
// app.json (mode 600) and github-app.env (the lines to paste into .env and the Vercel project).
//
// Run: node scripts/github-app-manifest.mjs [--org neuramesh-ai] [--name neuramesh] [--port 8798]
// then open http://127.0.0.1:<port>/ in a browser that is signed in to GitHub as an org owner.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const ORG = arg('org', 'neuramesh-ai');
const NAME = arg('name', 'neuramesh');
const PORT = Number(arg('port', process.env['PORT'] ?? '8798'));
const API = arg('api', 'https://api.neuramesh.app');
const OUT = join(process.cwd(), '.nm-evidence', 'github-app');
mkdirSync(OUT, { recursive: true });
const state = randomBytes(12).toString('hex');

// read only, by registration: a write is impossible, not merely avoided (plan §4.9)
const manifest = {
  name: NAME,
  url: 'https://neuramesh.app',
  description: 'NeuraMesh reads your releases and drafts the announcement for every account you connected. Read only.',
  redirect_url: `http://127.0.0.1:${PORT}/callback`,
  setup_url: `${API}/connect/github/callback`,
  setup_on_update: true,
  public: true,
  default_permissions: { metadata: 'read', contents: 'read', pull_requests: 'read' },
  default_events: ['release'],
  hook_attributes: { url: `${API}/webhooks/github`, active: false },
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const page = (title, body) => `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:15px/1.5 -apple-system,Helvetica,sans-serif;max-width:640px;margin:60px auto;padding:0 20px;color:#1c1a17}code,pre{font:13px ui-monospace,Menlo,monospace}pre{background:#f3f1ee;padding:12px;border-radius:6px;white-space:pre-wrap}button{font:500 14px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:-.02em;padding:8px 14px;border:1px solid #1c1a17;background:#1c1a17;color:#f5f4f2;border-radius:3px;cursor:pointer}</style>
<h1>${esc(title)}</h1>${body}`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/') {
    const action = `https://github.com/organizations/${ORG}/settings/apps/new?state=${state}`;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('Create the NeuraMesh GitHub App', `
<p>This page sends the manifest below to GitHub. On GitHub's page, press <b>Create GitHub App</b>. GitHub then returns here and this machine converts the code with <code>gh</code>.</p>
<form method="post" action="${esc(action)}" id="f"><input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}"><button type="submit">Continue on GitHub →</button></form>
<pre>${esc(JSON.stringify(manifest, null, 2))}</pre>`));
    return;
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.get('state') !== state) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('No code', '<p>GitHub did not send a code, or the state did not match. Start again from <a href="/">the form</a>.</p>'));
      return;
    }
    execFile('gh', ['api', '--method', 'POST', `/app-manifests/${code}/conversions`], { maxBuffer: 4_000_000 }, (err, stdout, stderr) => {
      if (err) {
        res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('The conversion failed', `<pre>${esc(stderr || err.message)}</pre>`));
        return;
      }
      const app = JSON.parse(stdout);
      writeFileSync(join(OUT, 'app.json'), JSON.stringify(app, null, 2));
      chmodSync(join(OUT, 'app.json'), 0o600);
      const env = [
        `GITHUB_APP_ID=${app.id}`,
        `GITHUB_APP_SLUG=${app.slug}`,
        `GITHUB_APP_CLIENT_ID=${app.client_id}`,
        `GITHUB_APP_PRIVATE_KEY_B64=${Buffer.from(app.pem, 'utf8').toString('base64')}`,
        `GITHUB_APP_WEBHOOK_SECRET=${app.webhook_secret}`,
      ].join('\n') + '\n';
      writeFileSync(join(OUT, 'github-app.env'), env);
      chmodSync(join(OUT, 'github-app.env'), 0o600);
      console.log(`created GitHub App ${app.slug} (id ${app.id}) → ${join(OUT, 'app.json')}`);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Created', `<p>The App <b>${esc(app.name)}</b> (<code>${esc(app.slug)}</code>, id ${esc(app.id)}) exists in <b>${esc(ORG)}</b>. Its private key and secrets are in <code>.nm-evidence/github-app/</code> on this machine. You can close this tab.</p><p><a href="${esc(app.html_url)}">Open the App on GitHub ↗</a></p>`));
      setTimeout(() => process.exit(0), 500);
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.listen(PORT, '127.0.0.1', () => console.log(`open http://127.0.0.1:${PORT}/ to create the "${NAME}" GitHub App in ${ORG} (state ${state})`));
