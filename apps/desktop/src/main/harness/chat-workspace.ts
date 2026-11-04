import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { chatWorkspaceDir, legacyChatWorkspaceDir } from '../chatmode';
import { adoptLegacyDir } from './migrate';

/** Agent tools and the thread terminal must see the same files, including older conversations. */
export function ensureChatWorkspace(threadId: string): string {
  const home = homedir();
  const directory = chatWorkspaceDir(home, threadId);
  try {
    adoptLegacyDir(legacyChatWorkspaceDir(home, threadId), directory, line => console.log(`agent_host ${line}`));
  } catch { /* An unavailable legacy workspace does not prevent a fresh conversation. */ }
  mkdirSync(directory, { recursive: true });
  return directory;
}
