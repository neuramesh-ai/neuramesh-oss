// THE AUTH IPC — sign in, sign up, sign out, and the OAuth round trips.
//
// Seven handlers split out of index.ts's whenReady block. They are one domain and they share
// one shape: authenticate, then start sync and resync the workspace.
//
// REGISTRATION POSITION IS LOAD-BEARING, so registerAuthIpc() is called from exactly where
// these lines used to sit and does nothing but register.
import { app, ipcMain } from 'electron';
import { login, loginWithGitHub, logout } from './auth';
import { clerkLogout, loginWithClerk, loginWithClerkOAuth, loginWithClerkPassword, signupWithClerkPassword } from './auth-clerk';
import { connections } from './connections';

/** the cloud connection's control-api (connections.ts: env in dev, then baked) — the dev-stack
 *  port stays the fallback for a clerk launch that named neither */
const clerkApi = (): string => connections.all().find((c) => c.authMode === 'clerk')?.apiUrl || 'http://127.0.0.1:8788';
export function registerAuthIpc(deps: {
  ensureSync: () => void;
  resyncWorkspace: () => Promise<unknown>;
}): void {
  const { ensureSync, resyncWorkspace } = deps;
ipcMain.handle('nm:auth-login', async (_e, { email, password }: { email: string; password: string }) => {
  const s = await login(email, password);
  ensureSync();
  return { user: s.user };
});
ipcMain.handle('nm:auth-github', async () => {
  const s = await loginWithGitHub();
  ensureSync();
  return { user: s.user };
});
ipcMain.handle('nm:auth-clerk', async () => {
  const s = await loginWithClerk(clerkApi());
  ensureSync();
  void resyncWorkspace(); // sign-out→sign-in in the same session: reconnect the stream to the new identity
  return { user: { id: s.userId, email: s.email } };
});
ipcMain.handle('nm:auth-clerk-oauth', async (_e, { provider }: { provider: 'google' | 'github' }) => {
  const s = await loginWithClerkOAuth(clerkApi(), provider);
  ensureSync();
  void resyncWorkspace();
  return { user: { id: s.userId, email: s.email } };
});
ipcMain.handle('nm:auth-clerk-password', async (_e, { email, password }: { email: string; password: string }) => {
  const s = await loginWithClerkPassword(clerkApi(), email, password);
  ensureSync();
  void resyncWorkspace();
  return { user: { id: s.userId, email: s.email } };
});
ipcMain.handle('nm:auth-clerk-signup', async (_e, { email, password }: { email: string; password: string }) => {
  const s = await signupWithClerkPassword(clerkApi(), email, password);
  ensureSync();
  void resyncWorkspace();
  return { user: { id: s.userId, email: s.email } };
});
ipcMain.handle('nm:auth-logout', async () => {
  logout();
  clerkLogout();
  // the replica belongs to the signed-out identity — never leave it for
  // the next sign-in to read or wedge on
  const { rmSync } = await import('node:fs');
  // The brain migration moved these files; this list used to be hardcoded to the OLD userData
  // names, so after migrating, signing out silently stopped wiping the replica and left the
  // previous identity's synced rows for the next sign-in to read. `identityFiles` covers both
  // locations, so it is correct before and after the migration.
  const { identityFiles } = await import('./harness/migrate');
  const { brainRoot } = await import('./harness/brain');
  for (const f of identityFiles(app.getPath('userData'), brainRoot())) rmSync(f, { force: true });
  app.relaunch();
  app.exit(0);
});
}
