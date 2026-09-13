// Authoritative proof of the Clerk-specific half of cloud sync: the local
// PowerSync — configured EXACTLY as cloud will be (Clerk's JWKS + the cloud
// instance URL as audience, see dev/stack/powersync/powersync.yaml) — must
// ACCEPT a real Clerk-minted RS256 token (the "powersync" JWT template) and
// reach connected + synced. A rejected token (bad JWKS/aud) never connects.
//
// The OTHER half — the nm_users-join sync rule mapping the Clerk `sub` → our
// uuid — is proven separately by the dev e2e gate (ISOLATION=PASS member_rows=2,
// which now runs through that exact join). Token from NM_CLERK_TOKEN.
import { mkdirSync, rmSync } from 'node:fs';
import { column, PowerSyncDatabase, Schema, SyncStreamConnectionMethod, Table } from '@powersync/node';

const token = process.env['NM_CLERK_TOKEN'];
if (!token) {
  console.log('CLERK_VERIFY=SKIP no NM_CLERK_TOKEN in env');
  process.exit(2);
}

// decode (no verify — PowerSync does the verifying) just to surface what we sent
const [, payloadB64 = ''] = token.split('.');
const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;
console.log(`token_claims alg=RS256 sub=${String(claims['sub']).slice(0, 12)} aud=${JSON.stringify(claims['aud'])} iss=${claims['iss']}`);

const channels = new Table({ workspace_id: column.text, slug: column.text });
const dir = '/tmp/nm-clerk-verify';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const db = new PowerSyncDatabase({
  schema: new Schema({ channels }),
  database: { dbFilename: 'cv.db', dbLocation: dir },
});

let downloadError = '';
db.registerListener({
  statusChanged: (s) => {
    const e = s.dataFlowStatus?.downloadError;
    if (e) downloadError = String(e);
  },
});

await db.connect(
  { fetchCredentials: async () => ({ endpoint: 'http://127.0.0.1:58081', token }), uploadData: async () => {} },
  { connectionMethod: SyncStreamConnectionMethod.HTTP },
);

// give the stream up to 15s to authenticate + complete a first checkpoint
const deadline = Date.now() + 15_000;
for (;;) {
  const s = db.currentStatus;
  if ((s.connected && s.lastSyncedAt) || Date.now() > deadline) break;
  await new Promise((r) => setTimeout(r, 250));
}

const st = db.currentStatus;
const connected = !!st.connected;
const synced = !!st.lastSyncedAt;
const rows = (await db.getAll('select id from channels')).length;
await db.disconnectAndClear();
await db.close();

// connected + synced ⇒ PowerSync validated the Clerk token against Clerk's JWKS
// with aud = the instance URL. rows depends on whether this Clerk identity maps to
// a seeded workspace (0 is fine here — the join is the dev gate's job, not this one).
if (connected && synced) {
  console.log(`CLERK_VERIFY=PASS connected=true synced=true channels=${rows} — PowerSync accepted the Clerk-signed RS256 token (Clerk JWKS + instance-URL audience)`);
  process.exit(0);
}
console.log(`CLERK_VERIFY=FAIL connected=${connected} synced=${synced} channels=${rows} downloadError=${downloadError || 'none'}`);
process.exit(1);
