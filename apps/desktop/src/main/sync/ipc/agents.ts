// The roster's write surface: agent updates, instructions, retirement, channel
// membership, provider credentials and the Claude Design connect flow — extracted
// from sync.ts.
import { app, shell } from 'electron';
import { api } from '../../sync';
import { ipcMain } from 'electron';
import { CLAUDE_DESIGN_APP_URL, CLAUDE_DESIGN_MCP_URL } from '@neuramesh/shared';
import { claudeDesignCliCommand, claudeDesignWorkspace } from '../../claudedesign';
import { contractFor, localContractPath, localInstructions, writeLocalInstructions } from '../../contracts';
import { setNotificationsEnabled } from '../../notify';
import type { PowerSyncDatabase } from '@powersync/node';

export interface AgentsDeps {
  db: () => PowerSyncDatabase;
  ws: () => string;
}

export function registerAgents({ db, ws }: AgentsDeps): void {
// edit a registered agent's brain (model/provider) or name — the daemon re-reads it live and
// re-routes that agent's workflow. The runtime's CLI (codex/gemini workers) is ensured lazily on
// the agent's next task by the adapter backstop.
ipcMain.handle('nm:agent-update', async (_e, input: { agentId: string; model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' }) =>
  api('/v1/commands', { type: 'agent.update', agent: input.agentId, model: input.model, runtime: input.runtime, name: input.name, description: input.description, brief: input.brief, modelSource: input.modelSource }));
// retire an agent (soft, human-only — the server refuses while it has open work).
// The daemon's boot watch drops it live; rehire = register the same name again.
// THIS MACHINE's instructions for an agent (0110 §B.1). Local-first: the file wins over the
// synced baseline, and nothing syncs it anywhere — an agent runs on one host, and how it
// behaves there is that host's to decide.
ipcMain.handle('nm:agent-instructions', async (_e, { name, role }: { name: string; role: string }) => ({
  local: localInstructions(name),
  shipped: contractFor(name, role)?.instructions?.trim() || null,
  path: localContractPath(name),
  // The shipped contract's prompt blocks, for the overlay's read-only preview. Behaviour must be
  // SEEABLE where it is edited: instructions are written right under a view of the prompt they
  // ride with, or people edit blind against a turn they have never read.
  prompt: contractFor(name, role)?.prompt ?? null,
}));
ipcMain.handle('nm:agent-instructions-write', async (_e, { name, instructions }: { name: string; instructions: string | null }) => {
  writeLocalInstructions(name, instructions);
  return { ok: true };
});
ipcMain.handle('nm:agent-retire', async (_e, { agentId }: { agentId: string }) =>
  api('/v1/commands', { type: 'agent.retire', agent: agentId }));
// the signed-in human edits their OWN display name — the control-api scopes the
// write to the actor (this user), so no target id is sent from the client.
ipcMain.handle('nm:update-profile', async (_e, { displayName }: { displayName: string }) =>
  api('/v1/commands', { type: 'member.update_profile', workspace: ws(), displayName: displayName.trim() }));
// the live-panel "+" — bring a workspace agent into the selected channel (one click, no card)
ipcMain.handle('nm:channel-add-agent', async (_e, { channelId, agent }: { channelId: string; agent: string }) =>
  api('/v1/commands', { type: 'channel.add_agent', workspace: ws(), channel: channelId, agent }));
// the add-agents overlay's other half — take an agent back out of a room. The server refuses
// for anyone but a human or the orchestrator, same guard as the add.
ipcMain.handle('nm:channel-remove-agent', async (_e, { channelId, agent }: { channelId: string; agent: string }) =>
  api('/v1/commands', { type: 'channel.remove_agent', workspace: ws(), channel: channelId, agent }));
// the People "+" — put a teammate who is ALREADY in the workspace into this room (0094).
// Not an invite: no seat is consumed and no workspace access is granted.
ipcMain.handle('nm:channel-add-person', async (_e, { channelId, person }: { channelId: string; person: string }) =>
  api('/v1/commands', { type: 'channel.add_person', workspace: ws(), channel: channelId, person }));
ipcMain.handle('nm:channel-remove-person', async (_e, { channelId, person }: { channelId: string; person: string }) =>
  api('/v1/commands', { type: 'channel.remove_person', workspace: ws(), channel: channelId, person }));
// the room's people roster — read from the local replica so the rail works offline
ipcMain.handle('nm:channel-people', async (_e, { channelId }: { channelId: string }) =>
  db().getAll(
    // the workspace_members join MUST be scoped by workspace as well as user: a person who
    // belongs to two workspaces has two rows there, and joining on user_id alone fans the
    // roster out — one member rendered twice, and the People count reading 3 for 2 people.
    `select cm.user_id, cm.created_at, cm.created_by, wm.display_name, wm.role
       from channel_members cm
       join channels c on c.id = cm.channel_id
       join workspace_members wm on wm.user_id = cm.user_id and wm.workspace_id = c.workspace_id
      where cm.channel_id = ? order by cm.created_at`,
    [channelId],
  ).catch(() => []));
// a room's papertrail (0093): who joined it and when, oldest first. The room's own creation
// rides the channels row, so this is only the membership half. Reads the local replica, so
// the trail renders offline with the rest of the feed.
ipcMain.handle('nm:channel-history', async (_e, { channelId }: { channelId: string }) =>
  db().getAll(
    `select ac.agent_id, ac.created_at, ac.created_by_kind, ac.created_by, a.name, a.role
       from agent_channels ac join agents a on a.id = ac.agent_id
      where ac.channel_id = ? and a.retired_at is null
      order by ac.created_at`,
    [channelId],
  ).catch(() => []));
// desktop-notification preference (persisted client-side; the renderer pushes it on boot + on change)
ipcMain.handle('nm:notify-set-enabled', (_e, on: boolean) => { setNotificationsEnabled(!!on); return { ok: true }; });

// ensure a runtime's coding CLI is installed (codex/gemini) — called at agent
// create so a Gemini/Codex agent's CLI is provisioned up front, not lazily on
// its first task. claude-code needs nothing here. Throws an actionable error if
// the install fails; the lazy ensureCli in the adapter is the backstop.
ipcMain.handle('nm:ensure-runtime-cli', async (_e, { runtime }: { runtime: string }) => {
  if (!runtime || runtime === 'claude-code') return { ok: true, runtime: runtime || 'claude-code' };
  const { ensureCli } = await import('../../runtime/cli');
  await ensureCli(runtime);
  return { ok: true, runtime };
});

// consume an external A2A agent by its card URL — registers it as a remote agent
ipcMain.handle('nm:agent-connect-remote', async (_e, { cardUrl, channels }: { cardUrl: string; channels: string[] }) =>
  api('/v1/commands', { type: 'agent.connect_remote', workspace: ws(), channels, cardUrl: cardUrl.trim() }));

ipcMain.handle('nm:credentials', async () => api(`/v1/credentials?workspace=${ws()}`));
// platforms only — the route never returns a push token, and neither does this
ipcMain.handle('nm:devices', async () => api('/v1/devices').catch(() => null));

// Per-machine model-provider detection (installed CLI + subscription login) for the
// "Bring your own brain" screen. Local only — nothing here reaches the cloud.
ipcMain.handle('nm:detect-providers', async () => {
  const { detectProviders } = await import('../../runtime/detect');
  return detectProviders();
});

// Claude Design is a remote MCP owned by Anthropic. We only alter the user's
// Claude CLI configuration from the explicit Connect action in the renderer.
ipcMain.handle('nm:claude-design-status', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { which } = await import('../../runtime/cli');
  const { detectProviders } = await import('../../runtime/detect');
  const bin = await which('claude');
  const providers = await detectProviders();
  if (!bin) return { configured: false, claudeAuthed: false, detail: 'Claude Code is not installed.' };
  try {
    const { stdout } = await promisify(execFile)(bin, ['mcp', 'get', 'claude-design'], { timeout: 8_000 });
    const configured = stdout.includes(CLAUDE_DESIGN_MCP_URL) || stdout.toLowerCase().includes('claude-design');
    return { configured, claudeAuthed: !!providers.anthropic?.authed, detail: configured ? 'Claude Design is connected.' : 'Claude Design is not connected.' };
  } catch {
    return { configured: false, claudeAuthed: !!providers.anthropic?.authed, detail: 'Claude Design is not connected.' };
  }
});

ipcMain.handle('nm:claude-design-connect', async (_event, { taskId }: { taskId?: string } = {}) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { which } = await import('../../runtime/cli');
  const bin = await which('claude');
  if (!bin) throw new Error('Install Claude Code before connecting Claude Design.');
  const run = promisify(execFile);
  try {
    await run(bin, ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'claude-design', CLAUDE_DESIGN_MCP_URL], { timeout: 12_000 });
  } catch (err) {
    // `add` may report an existing server. Confirm the final state before failing.
    try { await run(bin, ['mcp', 'get', 'claude-design'], { timeout: 8_000 }); }
    catch { throw err; }
  }

  let cwd = app.getPath('home');
  let taskNumber: number | null = null;
  if (taskId) {
    const task = await db().get<{ number: number; local_path: string | null }>(
      `select t.number, r.local_path from tasks t left join repos r on r.id = t.repo_id where t.id = ?`,
      [taskId],
    ).catch(() => null);
    if (task) {
      taskNumber = task.number;
      cwd = claudeDesignWorkspace(task.number, task.local_path);
      const { mkdir } = await import('node:fs/promises');
      await mkdir(cwd, { recursive: true });
    }
  }

  const command = claudeDesignCliCommand(bin);
  console.log(`claude_design_connect task=${taskId ?? 'none'} cwd=${cwd.replace(app.getPath('home'), '~')} surface=neuramesh-terminal`);
  await shell.openExternal(CLAUDE_DESIGN_APP_URL);
  return { configured: true, cwd, command, taskNumber };
});

// Re-run a provider's CLI login (the AuthCard "Reconnect" action). Spawns the login in a PTY so
// the interactive CLI behaves; surfaces the OAuth URL to the browser; then polls detection until
// the machine is authenticated (or a timeout). Local only — the login lives in the provider's
// own CLI store; NeuraMesh never sees the token.
ipcMain.handle('nm:provider-reauth', async (_e, { provider }: { provider: string }) => {
  const { detectProviders } = await import('../../runtime/detect');
  const { which } = await import('../../runtime/cli');

  // Google/Antigravity: agy's sign-in is INTERACTIVE (press Enter → browser OAuth → paste the code
  // back in the terminal), so — unlike codex/claude's localhost-callback logins — it can't be
  // driven from a headless PTY (it would just stall waiting for keystrokes). Open a REAL terminal
  // running `agy` so the user can complete it. We also can't probe agy's login STATE (no status
  // command — we treat the agy binary being present as the Google signal), so we report success
  // once agy is installed; a worker run surfaces a clear "run `agy` to sign in" error if the login
  // has actually lapsed. (data note: agy sends prompts to Google — disclosed in the providers UI.)
  if (provider === 'gemini') {
    const binPath = await which('agy');
    if (!binPath) return { authed: false }; // not installed → the UI surfaces install steps
    const { execFile } = await import('node:child_process');
    const open = (cmd: string, args: string[]): void => { execFile(cmd, args, () => { /* best effort */ }); };
    if (process.platform === 'darwin') {
      const safe = binPath.replace(/(["\\])/g, '\\$1'); // escape for the AppleScript string literal
      open('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${safe}"`]);
    } else if (process.platform === 'win32') {
      open('cmd', ['/c', 'start', '', binPath]);
    } else {
      open('x-terminal-emulator', ['-e', binPath]);
    }
    console.log('provider_reauth provider=gemini opened=terminal');
    return { authed: true };
  }

  const spec = provider === 'openai'
    ? { bin: 'codex', args: ['login'], key: 'openai' as const }
    : { bin: 'claude', args: ['auth', 'login'], key: 'anthropic' as const };
  const binPath = (await which(spec.bin)) ?? spec.bin; // resolve ~/.local/bin etc.
  let term: import('node-pty').IPty | null = null;
  try {
    const pty = await import('node-pty');
    term = pty.spawn(binPath, spec.args, { name: 'xterm-color', cols: 100, rows: 30, cwd: app.getPath('home'), env: { ...process.env } as Record<string, string> });
    let opened = false;
    term.onData((d) => {
      const url = /(https?:\/\/[^\s'"]+)/.exec(d);
      if (url && !opened) { opened = true; void shell.openExternal(url[1]!); } // help the user complete OAuth
    });
    console.log(`provider_reauth spawn=${spec.bin} ${spec.args.join(' ')}`);
  } catch (err) {
    console.error('provider_reauth spawn failed:', err);
  }
  // poll detection until authed or ~2.5 min; the user completes the browser sign-in meanwhile.
  let authed = false;
  for (let waited = 0; waited < 150_000; waited += 3000) {
    await new Promise((r) => setTimeout(r, 3000));
    const s = await detectProviders().catch(() => null);
    if (s && s[spec.key]?.authed) { authed = true; break; }
    if (!term) break; // couldn't even spawn → don't spin
  }
  try { term?.kill(); } catch { /* already gone */ }
  console.log(`provider_reauth provider=${provider} authed=${authed}`);
  return { authed };
});

ipcMain.handle('nm:credential-set', async (_e, input: { scope: 'workspace' | 'agent'; agentId?: string; token?: string; provider?: string; authMode?: 'apikey' | 'subscription' }) =>
  api('/v1/commands', { type: 'credential.set', workspace: ws(), provider: input.provider ?? 'anthropic', scope: input.scope, agentId: input.agentId, token: input.token, authMode: input.authMode ?? 'apikey' }),
);
}
