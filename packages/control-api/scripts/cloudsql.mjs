import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** A process-private Unix socket, backed by authenticated TLS to the private SQL address. */
export async function startCloudSql(env = process.env) {
  const instanceConnectionName = env.NM_CLOUDSQL_INSTANCE;
  if (!instanceConnectionName) return { path: undefined, close: async () => {} };
  if (!/^[a-z][a-z0-9-]+:[a-z0-9-]+:[a-z][a-z0-9-]+$/.test(instanceConnectionName)) throw new Error('Invalid Cloud SQL instance name');
  const ipType = env.NM_CLOUDSQL_IP_TYPE === 'PSC' ? IpAddressTypes.PSC : IpAddressTypes.PRIVATE;
  if (env.NM_CLOUDSQL_IP_TYPE && !['PRIVATE', 'PSC'].includes(env.NM_CLOUDSQL_IP_TYPE)) throw new Error('Cloud SQL requires a private connection type');
  const directory = await mkdtemp(join(tmpdir(), 'nm-cloudsql-'));
  const path = join(directory, '.s.PGSQL.5432');
  const connector = new Connector();
  const close = async () => { connector.close(); await rm(directory, { recursive: true, force: true }); };
  try {
    await connector.startLocalProxy({ instanceConnectionName, ipType, listenOptions: { path } });
    return { path, close };
  } catch { await close(); throw new Error('The authenticated private Cloud SQL connection could not start'); }
}
