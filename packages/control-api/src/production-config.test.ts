import { describe, expect, it } from 'vitest';
import { assertProductionConfig } from './production-config';

const production = (): NodeJS.ProcessEnv => ({
  NM_DEPLOYMENT: 'production', NODE_ENV: 'production', DATABASE_URL: 'postgres://nm:secret@localhost/nm',
  NM_MIGRATION_MODE: 'canary', NM_CANARY_CLERK_USER_IDS: 'user_qa',
  CLERK_PUBLISHABLE_KEY: 'pk_live_configured', CLERK_SECRET_KEY: 'configured', NM_CONNECTOR_KEY: 'configured',
  FLEET_SECRET: 'configured', RELAY_SECRET: 'configured',
  NM_SCHEDULER_EMAIL: 'scheduler@prd.iam.gserviceaccount.com', NM_SCHEDULER_AUDIENCE: 'https://api.run.app',
  NM_BRAIN_GCS_BUCKET: 'brain', NM_SNAPSHOT_GCS_BUCKET: 'snapshots', NM_REQUIRED_MIGRATION: '0177_thread_intake.sql',
  NM_VAULT: '1', NM_VAULT_KMS_KEY: 'projects/prd/locations/us-east4/keyRings/nm/cryptoKeys/vault',
  NM_CLOUDSQL_INSTANCE: 'fixture-prd:us-east4:fixture-pg',
});

describe('production deployment contract', () => {
  it('accepts a complete production profile and leaves local profiles independent', () => {
    expect(() => assertProductionConfig(production())).not.toThrow();
    expect(() => assertProductionConfig({})).not.toThrow();
  });
  it.each(['DATABASE_URL', 'CLERK_SECRET_KEY', 'NM_CONNECTOR_KEY', 'NM_BRAIN_GCS_BUCKET', 'NM_CLOUDSQL_INSTANCE'])('refuses missing %s', key => {
    const env = production(); delete env[key];
    expect(() => assertProductionConfig(env)).toThrow(key);
  });
  it.each(['NM_LOCAL', 'NM_E2E_ROUTES', 'NM_ALLOW_ACTOR_HEADER', 'NM_ALLOW_DEV_TOKENS', 'NM_ALLOW_DEV_RELAY'])('refuses the %s escape hatch', key => {
    expect(() => assertProductionConfig({ ...production(), [key]: '1' })).toThrow(key);
  });
  it('does not disclose malformed credential values in diagnostics', () => {
    expect(() => assertProductionConfig({ ...production(), DATABASE_URL: 'private-credential-value' })).toThrow('valid PostgreSQL URL');
  });
  it.each([{ NM_INPROC_CRONS: 'all' }, { NM_EMBED: 'on' }, { POWERSYNC_URL: 'legacy' }, { NM_SYNC_LISTEN_URL: 'bypass' }, { NM_VAULT: '0' }])('rejects incompatible runtime configuration %j', extra => {
    expect(() => assertProductionConfig({ ...production(), ...extra })).toThrow();
  });
});
