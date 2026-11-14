/** The target remains closed to customer identities until the final authority handoff. */
export function isMigrationCanary(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['NM_DEPLOYMENT'] === 'production' && env['NM_MIGRATION_MODE'] !== 'live';
}
export function migrationClerkUsers(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env['NM_CANARY_CLERK_USER_IDS'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
}
export function canaryClerkAllowed(subject: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  return !isMigrationCanary(env) || !!subject && migrationClerkUsers(env).includes(subject);
}
