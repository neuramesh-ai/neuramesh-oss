// The public face of the Cloud SQL connector (scripts/public-tree.sh PUBLIC_STUBS). This build connects
// through DATABASE_URL only.
export async function startCloudSql(env = process.env) {
  if (env.NM_CLOUDSQL_INSTANCE) throw new Error('This build has no Cloud SQL connector: connect through DATABASE_URL');
  return { path: undefined, close: async () => {} };
}
