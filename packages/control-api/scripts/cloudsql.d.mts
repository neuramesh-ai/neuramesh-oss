export function startCloudSql(env?: NodeJS.ProcessEnv): Promise<{ path: string | undefined; close(): Promise<void> }>;
