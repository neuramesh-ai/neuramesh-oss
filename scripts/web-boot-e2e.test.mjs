// The web boot probe's static server (scripts/web-boot-e2e.mjs): it serves the built client from one
// directory and nothing outside it, because a request is only ever a key into a table of the build's
// files (#559, after CodeQL's two findings on the public publish). Run: node --test scripts/web-boot-e2e.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { serve } from './web-boot-e2e.mjs';

/** one request on a raw socket, HTTP/1.0 so the body is not chunked: fetch() folds `..` away before the bytes leave */
function get(port, target) {
  return new Promise((res, rej) => {
    const s = connect(port, '127.0.0.1', () => s.write(`GET ${target} HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n`));
    let raw = '';
    s.setEncoding('utf8');
    s.on('data', (d) => { raw += d; });
    s.on('error', rej);
    s.on('end', () => {
      const [head, body = ''] = raw.split('\r\n\r\n');
      res({ status: Number(head.split(' ')[1]), type: /content-type: ([^\r\n]+)/i.exec(head)?.[1] ?? '', body });
    });
  });
}

let tmp; let srv; let port;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'nm-web-boot-test-'));
  mkdirSync(join(tmp, 'site'));
  writeFileSync(join(tmp, 'site', 'index.html'), '<html>the shell</html>');
  writeFileSync(join(tmp, 'site', 'app.js'), 'console.log(1)');
  writeFileSync(join(tmp, 'outside.txt'), 'NOT SERVED');
  ({ srv } = await serve(join(tmp, 'site')));
  port = srv.address().port;
});
after(() => { srv?.close(); rmSync(tmp, { recursive: true, force: true }); });

test('the built client is served: the root, an asset with its type, and the SPA fallback for a route', async () => {
  assert.deepEqual(await get(port, '/'), { status: 200, type: 'text/html', body: '<html>the shell</html>' });
  assert.deepEqual(await get(port, '/app.js?v=1'), { status: 200, type: 'text/javascript', body: 'console.log(1)' });
  assert.deepEqual(await get(port, '/some/route'), { status: 200, type: 'text/html', body: '<html>the shell</html>' });
});

test('a path that leaves the directory, raw or percent-encoded, or a bad escape, is answered as the fallback and the file outside is never read', async () => {
  for (const target of ['/../outside.txt', '/%2e%2e/outside.txt', '/a/../../outside.txt', '/..%2Foutside.txt', '/%zz']) {
    assert.deepEqual(await get(port, target), { status: 200, type: 'text/html', body: '<html>the shell</html>' }, target);
  }
});
