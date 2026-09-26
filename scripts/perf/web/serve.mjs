#!/usr/bin/env node
// serve.mjs: a static server for the BUILT browser client that behaves like the Vercel deployment.
//
//   node serve.mjs <buildDir> [--port 5341] [--api http://127.0.0.1:8841] [--host 127.0.0.1]
//                  [--cache immutable|vercel] [--vercel-json path/to/vercel.json] [--h2] [--log file]
//
// What it mimics (checked against https://hq.neuramesh.app on 2026-09-24 with curl):
//   - content encoding: brotli per Accept-Encoding (quality 3, lgwin 22: that reproduces the
//     production byte count of the main bundle to within 35 bytes), gzip level 6 as the fallback,
//     identity otherwise. Precompressed once at startup and cached on disk by content hash.
//   - Cache-Control:
//       --cache immutable (the default): /assets/* = public, max-age=31536000, immutable;
//                                        index.html + every other file = no-cache
//       --cache vercel: every static file = public, max-age=0, must-revalidate, which is what
//                       production sends TODAY for /assets/* too (vercel.json sets no Cache-Control)
//     Both answer If-None-Match with 304 (weak ETag per file, shared by all encodings, like Vercel).
//   - --vercel-json: the `headers` rules of a vercel.json are applied on top (source patterns of
//     the forms "/(.*)", "/assets/(.*)", "/:path*"), so an "after" build that adds a Cache-Control
//     rule is served the way Vercel would serve it.
//   - COOP same-origin + COEP require-corp (+ nosniff + referrer policy) on EVERY response.
//   - SPA fallback: a path with no "." anywhere is index.html (Vercel's `/((?!.*\\.).*)` rewrite);
//     a dotted path that is not a file is a 404.
//   - /v1, /auth, /connect: a streaming reverse proxy to --api (bodies and headers kept, chunked
//     and streamed responses piped through as they arrive).
//   - --h2: HTTP/2 over TLS (self-signed cert generated in ./certs, ALPN h2 + http/1.1), because
//     production is HTTP/2 and HTTP/1.1's six-connections-per-host limit changes a chunked load.
//     Chrome must be started with --ignore-certificate-errors-spki-list=<spki> (printed at start,
//     also written to certs/spki.txt): that makes the cert VALID, so the HTTP cache still works.
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { createSecureServer } from 'node:http2';
import { request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import zlib from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};
// Vercel compresses these MIME families; woff2/png/jpg/mp4 are already compressed
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.webmanifest', '.wasm', '.txt', '.map', '.ico', '.ttf', '.otf']);
const PROXY_PREFIXES = ['/v1/', '/auth/', '/connect/'];
const PROXY_EXACT = new Set(['/v1', '/auth', '/connect']);
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'http2-settings', 'host']);
const SECURITY = {
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export function parseArgs(argv) {
  const o = { dir: null, port: 5341, api: 'http://127.0.0.1:8841', host: '127.0.0.1', cache: null, vercelJson: null, h2: false, log: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '--api') o.api = argv[++i];
    else if (a === '--host') o.host = argv[++i];
    else if (a === '--cache') o.cache = argv[++i];
    else if (a === '--vercel-json') o.vercelJson = argv[++i];
    else if (a === '--h2') o.h2 = true;
    else if (a === '--log') o.log = argv[++i];
    else if (!a.startsWith('--') && !o.dir) o.dir = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.dir) throw new Error('usage: serve.mjs <buildDir> [--port N] [--api URL] [--cache immutable|vercel] [--vercel-json F] [--h2] [--log F]');
  if (!o.cache) o.cache = o.vercelJson ? 'vercel' : 'immutable';
  if (o.cache !== 'immutable' && o.cache !== 'vercel') throw new Error('--cache must be immutable or vercel');
  return o;
}

/** vercel.json `headers` rules → [{re, headers}] (the path-to-regexp subset vercel.json files here use) */
export function headerRules(vercelJsonPath) {
  if (!vercelJsonPath) return [];
  const cfg = JSON.parse(readFileSync(vercelJsonPath, 'utf8'));
  return (cfg.headers ?? []).map((r) => {
    const src = String(r.source)
      .replace(/:[A-Za-z_][A-Za-z0-9_]*\*/g, '(.*)')
      .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '([^/]+)');
    return { source: r.source, re: new RegExp(`^${src}$`), headers: Object.fromEntries((r.headers ?? []).map((h) => [String(h.key).toLowerCase(), String(h.value)])) };
  });
}

function certs() {
  const dir = join(here, 'certs');
  const key = join(dir, 'key.pem');
  const crt = join(dir, 'cert.pem');
  if (!existsSync(key) || !existsSync(crt)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt,
      '-days', '3650', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { stdio: 'ignore' });
  }
  // the SPKI pin Chrome's --ignore-certificate-errors-spki-list wants: base64(sha256(DER SubjectPublicKeyInfo))
  const pub = execFileSync('openssl', ['x509', '-in', crt, '-pubkey', '-noout']);
  const der = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub });
  const spki = createHash('sha256').update(der).digest('base64');
  writeFileSync(join(dir, 'spki.txt'), spki + '\n');
  return { key: readFileSync(key), cert: readFileSync(crt), spki };
}

/** walk the build once: url path → {file, type, etag, bodies{identity,br,gzip}} */
function loadBuild(dir) {
  const root = resolve(dir);
  const zdir = join(here, '.zcache');
  mkdirSync(zdir, { recursive: true });
  const files = new Map();
  const t0 = Date.now();
  let raw = 0, br = 0;
  const walk = (d, prefix) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue; // .sha and friends are not part of the site
      const rel = `${prefix}/${e.name}`;
      const abs = join(d, e.name);
      if (e.isDirectory()) { walk(abs, rel); continue; }
      const body = readFileSync(abs);
      const ext = extname(e.name).toLowerCase();
      const hash = createHash('sha256').update(body).digest('hex');
      const entry = { file: abs, type: MIME[ext] ?? 'application/octet-stream', etag: `W/"${hash.slice(0, 32)}"`, identity: body, br: null, gzip: null };
      if (COMPRESSIBLE.has(ext) && body.length > 256) {
        const brPath = join(zdir, `${hash}.q3.br`);
        const gzPath = join(zdir, `${hash}.l6.gz`);
        if (existsSync(brPath)) entry.br = readFileSync(brPath);
        else { entry.br = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 3, [zlib.constants.BROTLI_PARAM_LGWIN]: 22, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }); writeFileSync(brPath, entry.br); }
        if (existsSync(gzPath)) entry.gzip = readFileSync(gzPath);
        else { entry.gzip = zlib.gzipSync(body, { level: 6 }); writeFileSync(gzPath, entry.gzip); }
      }
      raw += body.length; br += (entry.br ?? body).length;
      files.set(rel, entry);
    }
  };
  walk(root, '');
  if (!files.has('/index.html')) throw new Error(`${root} has no index.html`);
  return { files, stats: { count: files.size, raw, br, ms: Date.now() - t0 } };
}

function pickEncoding(accept, entry) {
  const a = String(accept ?? '');
  if (entry.br && /\bbr\b/.test(a)) return ['br', entry.br];
  if (entry.gzip && /\bgzip\b/.test(a)) return ['gzip', entry.gzip];
  return [null, entry.identity];
}

export async function startServer(opts) {
  const { files, stats } = loadBuild(opts.dir);
  const rules = headerRules(opts.vercelJson);
  const api = new URL(opts.api);
  const log = opts.log ? (line) => appendFileSync(opts.log, line + '\n') : () => {};

  const cacheControlFor = (path) => {
    if (opts.cache === 'vercel') return 'public, max-age=0, must-revalidate';
    return path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
  };
  const ruleHeadersFor = (path) => {
    const out = {};
    for (const r of rules) if (r.re.test(path)) Object.assign(out, r.headers);
    return out;
  };

  const proxy = (req, res, path) => {
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith(':') || HOP.has(k.toLowerCase())) continue;
      headers[k] = v;
    }
    headers['host'] = api.host;
    headers['x-forwarded-host'] = req.headers[':authority'] ?? req.headers['host'] ?? '';
    headers['x-forwarded-proto'] = opts.h2 ? 'https' : 'http';
    const t0 = Date.now();
    const doRequest = api.protocol === 'https:' ? httpsRequest : httpRequest;
    const up = doRequest({ protocol: api.protocol, hostname: api.hostname, port: api.port, method: req.method, path: req.url, headers }, (ur) => {
      const out = { ...SECURITY };
      for (const [k, v] of Object.entries(ur.headers)) {
        if (HOP.has(k.toLowerCase())) continue;
        out[k] = v;
      }
      res.writeHead(ur.statusCode ?? 502, out);
      // flush every chunk as it arrives: a streamed body must reach the page when the API writes it
      ur.on('data', (c) => res.write(c));
      ur.on('end', () => { res.end(); log(`${new Date().toISOString()} ${req.method} ${path} -> ${ur.statusCode} proxied ${Date.now() - t0}ms`); });
      ur.on('error', () => { try { res.end(); } catch { /* closed */ } });
    });
    up.on('error', (e) => {
      log(`${new Date().toISOString()} ${req.method} ${path} -> 502 proxy error ${e.message}`);
      if (!res.headersSent) { res.writeHead(502, { ...SECURITY, 'content-type': 'application/json' }); }
      res.end(JSON.stringify({ error: `proxy: ${e.message}` }));
    });
    req.pipe(up);
  };

  const handler = (req, res) => {
    let path = '/';
    try { path = decodeURIComponent(String(req.url ?? '/').split('?')[0]); } catch { path = '/'; }
    if (PROXY_EXACT.has(path) || PROXY_PREFIXES.some((p) => path.startsWith(p))) return proxy(req, res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY); res.end(); return; }
    let entry = files.get(path);
    let served = path;
    if (!entry && (path === '/' || !path.includes('.'))) { entry = files.get('/index.html'); served = '/index.html'; }
    if (!entry) {
      res.writeHead(404, { ...SECURITY, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
      res.end('not found');
      log(`${new Date().toISOString()} GET ${path} -> 404`);
      return;
    }
    const headers = { ...SECURITY, 'content-type': entry.type, 'cache-control': cacheControlFor(served), etag: entry.etag, vary: 'Accept-Encoding', ...ruleHeadersFor(path) };
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      res.end();
      log(`${new Date().toISOString()} GET ${path} -> 304`);
      return;
    }
    const [enc, body] = pickEncoding(req.headers['accept-encoding'], entry);
    if (enc) headers['content-encoding'] = enc;
    headers['content-length'] = String(body.length);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(body);
    log(`${new Date().toISOString()} GET ${path} -> 200 ${enc ?? 'identity'} ${body.length}`);
  };

  let spki = null;
  let server;
  if (opts.h2) {
    const c = certs();
    spki = c.spki;
    server = createSecureServer({ key: c.key, cert: c.cert, allowHTTP1: true }, handler);
  } else {
    server = createHttpServer(handler);
    server.keepAliveTimeout = 65_000;
  }
  await new Promise((r) => server.listen(opts.port, opts.host, r));
  const origin = `${opts.h2 ? 'https' : 'http'}://${opts.host}:${opts.port}`;
  return { server, origin, spki, stats, close: () => new Promise((r) => server.close(() => r())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  const s = await startServer(opts);
  console.log(`[serve] ${s.origin} ← ${resolve(opts.dir)} (${s.stats.count} files, ${(s.stats.raw / 1e6).toFixed(2)} MB raw, ${(s.stats.br / 1e6).toFixed(2)} MB br, loaded in ${s.stats.ms} ms)`);
  console.log(`[serve] cache=${opts.cache}${opts.vercelJson ? ` vercel-json=${opts.vercelJson}` : ''} api=${opts.api} h2=${opts.h2}`);
  if (s.spki) console.log(`[serve] chrome flag: --ignore-certificate-errors-spki-list=${s.spki}`);
  const stop = () => { s.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 1000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
