// One PowerSync config serves the dev stack and the local stack, with every difference arriving
// as PS_* env (dev/stack/powersync/powersync.yaml). PowerSync substitutes only PS_-prefixed names
// and treats an unset one as a boot error, so the two compose files must each supply every `!env`
// the yaml names — this file is what keeps the three in step. The local compose is also the
// desktop's contract (U3a renders it), so its shape is pinned here: loopback ports, pinned images,
// the bind mounts a person can back up, and no Postgres port.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCAL_SYNC_AUD, LOCAL_SYNC_KID } from '../src/local-auth';

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const yaml = read('dev/stack/powersync/powersync.yaml');
const devCompose = read('dev/stack/docker-compose.yaml');
const localCompose = read('apps/desktop/resources/local/docker-compose.yaml');
const envExample = read('apps/desktop/resources/local/.env.example');

const envNames = (text: string): string[] => [...new Set([...text.matchAll(/!env\s+([A-Z0-9_:]+)/g)].map((m) => m[1]!.split('::')[0]!))].sort();
/** one compose service's block: from its header to the next service header, or the end of the file */
const serviceBlock = (compose: string, service: string): string => {
  const start = compose.indexOf(`\n  ${service}:\n`);
  if (start < 0) return '';
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};
/** the environment block of one compose service, as key → raw value */
const serviceEnv = (compose: string, service: string): Record<string, string> => {
  const env = /^    environment:\n((?:      .*\n?)+)/m.exec(serviceBlock(compose, service))?.[1] ?? '';
  return Object.fromEntries([...env.matchAll(/^\s{6}([A-Z0-9_]+):\s*(.*)$/gm)].map((m) => [m[1]!, m[2]!]));
};
/** the file with its comment lines removed — what compose actually reads */
const uncommented = (text: string): string => text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

describe('dev/stack/powersync/powersync.yaml reads its per-stack values from env', () => {
  const names = envNames(yaml);

  it('names exactly the six PS_ values, all PS_-prefixed', () => {
    expect(names).toEqual(['PS_NM_ADMIN_TOKEN', 'PS_NM_AUDIENCE', 'PS_NM_CLOUD_AUDIENCE', 'PS_NM_JWKS_URI', 'PS_NM_MACHINE_JWK_N', 'PS_NM_SYNC_KEY', 'PS_NM_SYNC_KID']);
    for (const n of names) expect(n.startsWith('PS_')).toBe(true);
  });

  it('carries no committed dev secret any more: the key, the kid and the admin token come from env', () => {
    expect(yaml).not.toMatch(/TkVVUkFNRVNILVNQSUtFLUtFWS0wMDE/);
    expect(yaml).not.toMatch(/nm-dev-admin-token/);
    expect(yaml).not.toMatch(/kid: 'nm-dev'/);
    expect(yaml).toMatch(/k: !env PS_NM_SYNC_KEY/);
    expect(yaml).toMatch(/kid: !env PS_NM_SYNC_KID/);
    expect(yaml).toMatch(/jwks_uri: !env PS_NM_JWKS_URI/);
    expect(yaml).toMatch(/- !env PS_NM_ADMIN_TOKEN/);
    expect(yaml).toMatch(/n: !env PS_NM_MACHINE_JWK_N/);
    expect(yaml).toMatch(/audience: \[!env PS_NM_AUDIENCE, !env PS_NM_CLOUD_AUDIENCE, 'powersync'\]/);
    // no instance URL of ours ships in a file every local stack receives
    expect(yaml).not.toMatch(/powersync\.journeyapps\.com/);
  });

  it('the dev compose supplies every name as a default equal to the committed dev value', () => {
    const env = serviceEnv(devCompose, 'powersync');
    for (const n of names) expect(env[n], n).toBeDefined();
    expect(env['PS_NM_SYNC_KID']).toBe('${PS_NM_SYNC_KID:-nm-dev}');
    expect(env['PS_NM_SYNC_KEY']).toBe('${PS_NM_SYNC_KEY:-TkVVUkFNRVNILVNQSUtFLUtFWS0wMDEtTkVVUkFNRVNILVNQSUtFLUtFWS0wMDE}');
    expect(env['PS_NM_AUDIENCE']).toBe('${PS_NM_AUDIENCE:-powersync-dev}');
    expect(env['PS_NM_CLOUD_AUDIENCE']).toBe('${PS_NM_CLOUD_AUDIENCE:-powersync}');
    expect(env['PS_NM_ADMIN_TOKEN']).toBe('${PS_NM_ADMIN_TOKEN:-nm-dev-admin-token}');
    expect(env['PS_NM_JWKS_URI']).toMatch(/^\$\{PS_NM_JWKS_URI:-https:\/\/.*clerk.*jwks\.json\}$/);
    expect(env['PS_NM_MACHINE_JWK_N']).toBe('${PS_NM_MACHINE_JWK_N:-}');
  });

  it('the local compose supplies every name, mapped from the desktop\'s NM_* env, with the local kid and audience', () => {
    const env = serviceEnv(localCompose, 'powersync');
    for (const n of names) expect(env[n], n).toBeDefined();
    expect(env['PS_NM_SYNC_KID']).toBe(LOCAL_SYNC_KID);
    expect(env['PS_NM_AUDIENCE']).toBe(LOCAL_SYNC_AUD);
    expect(env['PS_NM_CLOUD_AUDIENCE']).toBe(LOCAL_SYNC_AUD);
    expect(env['PS_NM_SYNC_KEY']).toBe('${NM_SYNC_KEY}');
    expect(env['PS_NM_ADMIN_TOKEN']).toMatch(/^\$\{NM_ADMIN_TOKEN/);
    // no Clerk and no egress: the remote JWKS is the control-api's own
    expect(env['PS_NM_JWKS_URI']).toBe('http://control-api:8787/v1/sync-jwks');
  });
});

describe('apps/desktop/resources/local/docker-compose.yaml is the desktop\'s contract', () => {
  it('pins the three images, with the control-api tag from NM_IMAGE_TAG', () => {
    expect(localCompose).toMatch(/image: pgvector\/pgvector:pg16/);
    expect(localCompose).toMatch(/image: journeyapps\/powersync-service:1\.26/);
    expect(localCompose).toMatch(/image: \$\{NM_IMAGE:-ghcr\.io\/neuramesh-ai\/neuramesh-control-api\}:\$\{NM_IMAGE_TAG/);
    expect(localCompose).toMatch(/wal_level=logical/);
  });

  it('publishes the API and PowerSync on loopback only, and Postgres not at all', () => {
    expect(localCompose).toMatch(/"127\.0\.0\.1:\$\{NM_API_PORT:-8788\}:8787"/);
    expect(localCompose).toMatch(/"127\.0\.0\.1:\$\{NM_POWERSYNC_PORT:-58081\}:8080"/);
    expect(serviceBlock(localCompose, 'pg')).not.toMatch(/^\s+ports:/m);
    expect(localCompose).not.toMatch(/"0\.0\.0\.0:/);
  });

  it('keeps the data where a person can see and back it up: bind mounts under NM_LOCAL_DIR, and never down -v', () => {
    expect(localCompose).toMatch(/\$\{NM_LOCAL_DIR[^}]*\}\/pgdata:\/var\/lib\/postgresql\/data/);
    expect(localCompose).toMatch(/\$\{NM_LOCAL_DIR\}\/powersync:\/config:ro/);
    expect(uncommented(localCompose)).not.toMatch(/down -v/m);
    expect(localCompose).toMatch(/Never run `docker compose down -v`/);
  });

  it('hands the control-api the local facts: NM_LOCAL, the bearer hash, the shared key, the closed header, no fleet, no push, mail dry-run', () => {
    const env = serviceEnv(localCompose, 'control-api');
    expect(env['NM_LOCAL']).toBe('"1"');
    expect(env['NM_LOCAL_HUMAN_TOKEN_HASH']).toMatch(/^\$\{NM_LOCAL_HUMAN_TOKEN_HASH/);
    expect(env['NM_SYNC_KEY']).toMatch(/^\$\{NM_SYNC_KEY/);
    expect(env['NM_POWERSYNC_URL']).toBe('http://127.0.0.1:${NM_POWERSYNC_PORT:-58081}');
    expect(env['NM_ALLOW_ACTOR_HEADER']).toBe('"0"');
    expect(env['FLEET_AUTOPROVISION']).toBe('"off"');
    expect(env['PUSH_ENABLED']).toBe('"0"');
    expect(env['NM_MAIL_DRY_RUN']).toBe('"1"');
    expect(env['NM_ALLOW_DEV_TOKENS']).toBeUndefined();
  });

  it('.env.example names every NM_* the compose file reads', () => {
    const wanted = [...new Set([...localCompose.matchAll(/\$\{(NM_[A-Z_]+)/g)].map((m) => m[1]!))].sort();
    expect(wanted).toEqual(['NM_ADMIN_TOKEN', 'NM_API_PORT', 'NM_IMAGE', 'NM_IMAGE_TAG', 'NM_LOCAL_DIR', 'NM_LOCAL_HUMAN_TOKEN_HASH', 'NM_POWERSYNC_PORT', 'NM_SYNC_KEY']);
    for (const name of wanted) expect(envExample, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
  });
});
