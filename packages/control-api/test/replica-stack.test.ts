// Every client uses the authenticated API replica. Pin the local stack's two services,
// private ports and durable object volume independently of hosted infrastructure.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
const devCompose = read('dev/stack/docker-compose.yaml');
const localCompose = read('apps/desktop/resources/local/docker-compose.yaml');
const gcsCompose = read('apps/desktop/resources/local/docker-compose.gcs.yaml');
const envExample = read('apps/desktop/resources/local/.env.example');

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

describe('apps/desktop/resources/local/docker-compose.yaml is the desktop\'s contract', () => {
  it('pins the two images, with the control-api tag from NM_IMAGE_TAG', () => {
    expect(localCompose).toMatch(/image: pgvector\/pgvector:pg16/);
    expect([...localCompose.matchAll(/^    image:/gm)]).toHaveLength(2);
    expect(localCompose).toMatch(/image: \$\{NM_IMAGE:-ghcr\.io\/neuramesh-ai\/neuramesh-control-api\}:\$\{NM_IMAGE_TAG/);
    expect(localCompose).not.toMatch(/wal_level=logical/);
    expect(devCompose).not.toMatch(/wal_level=logical|journeyapps/);
  });

  it('publishes only the API on loopback, and Postgres not at all', () => {
    expect(localCompose).toMatch(/"127\.0\.0\.1:\$\{NM_API_PORT:-8788\}:8787"/);
    expect(localCompose).not.toMatch(/NM_POWERSYNC_PORT/);
    expect(serviceBlock(localCompose, 'pg')).not.toMatch(/^\s+ports:/m);
    expect(localCompose).not.toMatch(/"0\.0\.0\.0:/);
  });

  it('keeps the data where a person can see and back it up: bind mounts under NM_LOCAL_DIR, and never down -v', () => {
    expect(localCompose).toMatch(/\$\{NM_LOCAL_DIR[^}]*\}\/pgdata:\/var\/lib\/postgresql\/data/);
    expect(localCompose).toMatch(/\$\{NM_LOCAL_DIR\}\/brain-objects:\/brain-objects/);
    expect(uncommented(localCompose)).not.toMatch(/down -v/m);
    expect(localCompose).toMatch(/Never run `docker compose down -v`/);
  });

  it('hands the API local authentication, replica and object storage settings with no fleet, push or live mail', () => {
    const env = serviceEnv(localCompose, 'control-api');
    expect(env['NM_LOCAL']).toBe('"1"');
    expect(env['NM_LOCAL_HUMAN_TOKEN_HASH']).toMatch(/^\$\{NM_LOCAL_HUMAN_TOKEN_HASH/);
    expect(env['NM_LOCAL_SYNC']).toBe('"1"');
    expect(env['NM_BRAIN_STORAGE_DIR']).toBe('/brain-objects');
    expect(env['NM_SYNC_KEY']).toBeUndefined();
    expect(env['NM_POWERSYNC_URL']).toBeUndefined();
    expect(env['NM_ALLOW_ACTOR_HEADER']).toBe('"0"');
    expect(env['FLEET_AUTOPROVISION']).toBe('"off"');
    expect(env['PUSH_ENABLED']).toBe('"0"');
    expect(env['NM_MAIL_DRY_RUN']).toBe('"1"');
    expect(env['NM_ALLOW_DEV_TOKENS']).toBeUndefined();
  });

  it('.env.example names every NM_* the compose file reads', () => {
    const wanted = [...new Set([...localCompose.matchAll(/\$\{(NM_[A-Z_]+)/g)].map((m) => m[1]!))].sort();
    expect(wanted).toEqual(['NM_API_PORT', 'NM_IMAGE', 'NM_IMAGE_TAG', 'NM_LOCAL_DIR', 'NM_LOCAL_HUMAN_TOKEN_HASH']);
    for (const name of wanted) expect(envExample, name).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
  });

  it('GCS is an explicit override with a read-only credential file and declared inputs', () => {
    expect(localCompose).not.toMatch(/GOOGLE_APPLICATION_CREDENTIALS|NM_BRAIN_GCS_BUCKET/);
    expect(serviceEnv(gcsCompose, 'control-api')['GOOGLE_APPLICATION_CREDENTIALS']).toBe('/run/neuramesh/gcp-adc.json');
    expect(gcsCompose).toMatch(/read_only: true/);
    expect(gcsCompose).toMatch(/create_host_path: false/);
    for (const name of ['NM_BRAIN_GCS_BUCKET', 'NM_BRAIN_ADC_FILE']) {
      expect(gcsCompose).toContain('${' + name + ':?');
      expect(envExample).toMatch(new RegExp(`^#? ?${name}=`, 'm'));
    }
  });
});
