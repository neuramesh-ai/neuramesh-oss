/** Explicit deployment profile: local development and the audit sandbox keep their own contract. */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NM_DEPLOYMENT'] !== 'production') return;
  const required = ['DATABASE_URL', 'CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY', 'NM_CONNECTOR_KEY',
    'FLEET_SECRET', 'RELAY_SECRET', 'NM_BRAIN_GCS_BUCKET',
    'NM_SNAPSHOT_GCS_BUCKET', 'NM_REQUIRED_MIGRATION', 'NM_VAULT_KMS_KEY', 'NM_CLOUDSQL_INSTANCE',
    'NM_SCHEDULER_EMAIL', 'NM_SCHEDULER_AUDIENCE'];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`Production configuration is missing: ${missing.join(', ')}`);
  if (env['NODE_ENV'] !== 'production') throw new Error('Production requires NODE_ENV=production');
  if (!['canary', 'live'].includes(env['NM_MIGRATION_MODE'] ?? '')) throw new Error('Production requires an explicit NM_MIGRATION_MODE');
  if (env['NM_MIGRATION_MODE'] === 'canary' && !(env['NM_CANARY_CLERK_USER_IDS'] ?? '').split(',').every(value => /^user_[A-Za-z0-9_-]+$/.test(value.trim()))) {
    throw new Error('The migration canary requires explicit approved Clerk test identities');
  }
  for (const key of ['NM_LOCAL', 'NM_E2E_ROUTES', 'NM_ALLOW_ACTOR_HEADER', 'NM_ALLOW_DEV_TOKENS', 'NM_ALLOW_DEV_RELAY']) {
    if (env[key] && env[key] !== '0') throw new Error(`Production forbids ${key}`);
  }
  if (env['NM_INPROC_CRONS'] || env['NM_EMBED'] === 'on') throw new Error('Production request-billed API requires external maintenance');
  if (env['NM_BRAIN_STORAGE_DIR'] || env['POWERSYNC_URL'] || env['NM_SYNC_LISTEN_URL']) throw new Error('Production requires GCS brain storage and API replica sync on the authenticated database connection');
  if (env['NM_VAULT'] !== '1') throw new Error('Production requires the encrypted machine vault');
  if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(env['NM_VAULT_KMS_KEY']!)) {
    throw new Error('Production requires a Cloud KMS vault key');
  }
  let db: URL;
  try { db = new URL(env['DATABASE_URL']!); }
  catch { throw new Error('Production requires a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(db.protocol)) throw new Error('Production requires PostgreSQL');
}
