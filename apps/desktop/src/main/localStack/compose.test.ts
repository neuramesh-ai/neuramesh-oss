// The compose render and the .env writer: the exact key set, 0600, idempotent on a second boot,
// the tag change detected, the images the pull is asked for, and the pull progress parser.
//   pnpm exec tsx --test src/main/localStack/compose.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENV_KEYS, PullProgress, composeCommand, composeImages, isHumanBearer, mintSecrets, parseEnv, parsePullLine, planEnv, renderEnv, sha256Hex, substitute,
} from './compose';

const COMPOSE = readFileSync(join(import.meta.dirname, '..', '..', '..', 'resources', 'local', 'docker-compose.yaml'), 'utf8');
const BEARER = `nmh_${'a'.repeat(48)}`;
// deterministic "random": a counter so two mints never collide in a test
let n = 0;
const random = (k: number) => Buffer.alloc(k, ++n);

test('the env holds EXACTLY the seven keys, in table order', () => {
  const plan = planEnv({ existing: {}, version: '0.132.0', dir: '/home/dana/.neuramesh/local', bearer: BEARER, random });
  assert.deepEqual(Object.keys(plan.env), [...ENV_KEYS]);
  assert.deepEqual([...ENV_KEYS], ['NM_IMAGE_TAG', 'NM_LOCAL_DIR', 'NM_SYNC_KEY', 'NM_ADMIN_TOKEN', 'NM_LOCAL_HUMAN_TOKEN_HASH', 'NM_API_PORT', 'NM_POWERSYNC_PORT']);
  assert.equal(plan.env.NM_IMAGE_TAG, '0.132.0');
  assert.equal(plan.env.NM_LOCAL_DIR, '/home/dana/.neuramesh/local');
  assert.equal(plan.env.NM_API_PORT, '8788');
  assert.equal(plan.env.NM_POWERSYNC_PORT, '58081');
  assert.equal(plan.env.NM_LOCAL_HUMAN_TOKEN_HASH, sha256Hex(BEARER), 'the hash, never the bearer');
  assert.ok(!renderEnv(plan.env).includes(BEARER), 'the secret is not in the file');
  assert.match(plan.env.NM_SYNC_KEY, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
  assert.match(plan.env.NM_ADMIN_TOKEN, /^[0-9a-f]{48}$/);
  assert.equal(plan.firstRun, true);
  assert.equal(plan.tagChanged, false, 'a first run downloads, it does not update');
  assert.equal(plan.changed, true);
});

test('a second boot keeps the secrets, rewrites nothing, and reports no tag change', () => {
  const first = planEnv({ existing: {}, version: '0.132.0', dir: '/d', bearer: BEARER, random });
  const again = planEnv({ existing: parseEnv(renderEnv(first.env)), version: '0.132.0', dir: '/d', bearer: BEARER, random });
  assert.deepEqual(again.env, first.env);
  assert.equal(again.changed, false);
  assert.equal(again.tagChanged, false);
  assert.equal(again.firstRun, false);
});

test('a new app version changes the tag and nothing else — the Update state', () => {
  const first = planEnv({ existing: {}, version: '0.132.0', dir: '/d', bearer: BEARER, random });
  const next = planEnv({ existing: parseEnv(renderEnv(first.env)), version: '0.133.0', dir: '/d', bearer: BEARER, random });
  assert.equal(next.tagChanged, true);
  assert.equal(next.changed, true);
  assert.equal(next.env.NM_SYNC_KEY, first.env.NM_SYNC_KEY);
  assert.equal(next.env.NM_ADMIN_TOKEN, first.env.NM_ADMIN_TOKEN);
  assert.equal(next.env.NM_IMAGE_TAG, '0.133.0');
});

test('a re-minted bearer (the keychain was lost) lands as a new hash on the next boot', () => {
  const first = planEnv({ existing: {}, version: '0.132.0', dir: '/d', bearer: BEARER, random });
  const other = `nmh_${'b'.repeat(48)}`;
  const next = planEnv({ existing: parseEnv(renderEnv(first.env)), version: '0.132.0', dir: '/d', bearer: other, random });
  assert.equal(next.env.NM_LOCAL_HUMAN_TOKEN_HASH, sha256Hex(other));
  assert.equal(next.changed, true);
  assert.equal(next.tagChanged, false);
});

test('parseEnv keeps the seven keys and drops anything a hand edit added', () => {
  assert.deepEqual(parseEnv('NM_IMAGE_TAG=1.2.3\nFOO=bar\n# comment\nNM_API_PORT=9999\n\nNM_IMAGE=ghcr.io/x\n'), { NM_IMAGE_TAG: '1.2.3', NM_API_PORT: '9999' });
  assert.deepEqual(parseEnv(null), {});
});

test('mintSecrets: 32 bytes base64url, 48 hex, and an nmh_ bearer of 48 hex', () => {
  const s = mintSecrets();
  assert.match(s.syncKey, /^[A-Za-z0-9_-]{43}$/);
  assert.match(s.adminToken, /^[0-9a-f]{48}$/);
  assert.ok(isHumanBearer(s.humanBearer));
  assert.equal(isHumanBearer('nmh_short'), false);
  assert.equal(isHumanBearer(null), false);
});

test('substitute handles the three compose forms', () => {
  assert.equal(substitute('${A}-${B:-dflt}-${C:-}', { A: 'a' }), 'a-dflt-');
  assert.equal(substitute('${A:-dflt}', { A: 'x' }), 'x');
  assert.throws(() => substitute('${NM_IMAGE_TAG:?set it}', {}), /NM_IMAGE_TAG is not set: set it/);
});

test('the shipped compose file names three images and the pull asks for them by service, versioned by the app', () => {
  const env = planEnv({ existing: {}, version: '0.132.0', dir: '/d', bearer: BEARER, random }).env;
  const images = composeImages(COMPOSE, env);
  assert.deepEqual(images.map((i) => i.service), ['pg', 'control-api', 'powersync']);
  assert.deepEqual(images.map((i) => i.label), ['Postgres', 'NeuraMesh API', 'PowerSync']);
  assert.equal(images.find((i) => i.service === 'control-api')!.image, 'ghcr.io/neuramesh-ai/neuramesh-control-api:0.132.0');
  assert.equal(images.find((i) => i.service === 'pg')!.image, 'pgvector/pgvector:pg16');
  // the whole file renders with the seven keys and nothing else — no `${…:?}` is left unfed
  assert.doesNotThrow(() => substitute(COMPOSE, env));
  assert.ok(!COMPOSE.includes('down -v') || /Never run `docker compose down -v`/.test(COMPOSE), 'down -v appears only as the warning');
});

test('composeCommand names the project, folder, env file and compose file; the standalone binary when we installed one; never down -v', () => {
  const dir = '/home/dana/.neuramesh/local';
  const plugin = composeCommand({ dockerBin: '/usr/local/bin/docker', root: '/home/dana/.neuramesh', dir, hasStandalone: false }, ['up', '-d']);
  assert.equal(plugin.bin, '/usr/local/bin/docker');
  assert.deepEqual(plugin.args, ['compose', '--project-name', 'neuramesh-local', '--project-directory', dir, '--env-file', `${dir}/.env`, '-f', `${dir}/docker-compose.yaml`, 'up', '-d']);
  const standalone = composeCommand({ dockerBin: '/home/dana/.neuramesh/bin/docker', root: '/home/dana/.neuramesh', dir, hasStandalone: true }, ['stop']);
  assert.equal(standalone.bin, '/home/dana/.neuramesh/bin/docker-compose');
  assert.equal(standalone.args[0], '--project-name');
  assert.equal(standalone.args.at(-1), 'stop');
  assert.throws(() => composeCommand({ dockerBin: 'docker', root: '/h', dir, hasStandalone: false }, ['down', '-v']), /never run/);
});

test('parsePullLine reads docker pull lines as bytes, and PullProgress sums the layers', () => {
  assert.deepEqual(parsePullLine('a1b2c3d4e5f6: Downloading [=====>      ]  12.3MB/45.6MB'), { layer: 'a1b2c3d4e5f6', status: 'downloading', current: 12_300_000, total: 45_600_000 });
  assert.deepEqual(parsePullLine('a1b2c3d4e5f6: Extracting [==>  ]  1.5kB/3kB'), { layer: 'a1b2c3d4e5f6', status: 'extracting', current: 1500, total: 3000 });
  assert.equal(parsePullLine('a1b2c3d4e5f6: Pull complete')?.status, 'complete');
  assert.equal(parsePullLine('a1b2c3d4e5f6: Already exists')?.status, 'exists');
  assert.equal(parsePullLine('pg16: Pulling from pgvector/pgvector'), null);
  const p = new PullProgress();
  p.feed('a1b2c3d4e5f6: Downloading [>  ]  1MB/10MB');
  p.feed('ffffffffffff: Downloading [>  ]  2MB/20MB');
  assert.equal(p.bytes, 3_000_000);
  assert.equal(p.total, 30_000_000);
  p.feed('a1b2c3d4e5f6: Pull complete');
  assert.equal(p.bytes, 12_000_000);
});
