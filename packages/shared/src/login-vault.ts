// THE LOGIN VAULT's wire (Cloud Run architecture §7, decision D1). A Cloud Run machine keeps its home
// in RAM, so every vendor login a person makes in the box terminal is lost at the next stop. machined
// uploads the allowlisted login files to nm-api, which keeps them encrypted per machine, and the next
// boot writes them back before the box starts. Only these paths ever cross: nm-api refuses any other,
// and machined reads no other. One list, so the box binds, the agent and the route cannot drift.
//
// Pure: no fs, no Buffer. machined and nm-api both import it.

/** the allowlisted login files, relative to HOME (/nm/home on the machine, /root in the box) */
export const VAULT_LOGIN_FILES = [
  '.claude/.credentials.json',
  '.codex/auth.json',
  '.gemini/antigravity-cli/antigravity-oauth-token',
  '.config/gh/hosts.yml',
  '.gitconfig',
] as const;
export type VaultLoginFile = (typeof VAULT_LOGIN_FILES)[number];

/** one login file is at most this many bytes (the largest real one, a Claude credential, is ~1 KiB) */
export const VAULT_FILE_MAX_BYTES = 64 * 1024;
/** all files together, decoded */
export const VAULT_TOTAL_MAX_BYTES = 256 * 1024;

export function isVaultLoginFile(path: string): path is VaultLoginFile {
  return (VAULT_LOGIN_FILES as readonly string[]).includes(path);
}

/** one file as it crosses: the bytes in base64 */
export interface VaultFile { path: VaultLoginFile; data: string }

/** GET /v1/machines/vault answers this. generation 0 = nothing stored yet */
export interface VaultRead { generation: number; files: VaultFile[] }

/** PUT /v1/machines/vault takes this: the full set of login files that exist now. A file that is
 *  absent was signed out of, and the vault forgets it. `baseGeneration` is the generation the
 *  machine last read or wrote (compare and swap), `epoch` the machine's fence. */
export interface VaultWrite { epoch: number; baseGeneration: number; files: VaultFile[] }

/** the refusal codes a machine acts on */
export const VAULT_CODES = {
  /** the vault is not switched on for this server (NM_VAULT) */
  off: 'VAULT_OFF',
  /** the machine is shared by several people: it never keeps a login */
  shared: 'VAULT_SHARED_MACHINE',
  /** only a Cloud Run machine has a vault: a volume machine keeps its home on disk */
  substrate: 'VAULT_NOT_CLOUDRUN',
  /** the generation moved since the machine last read it */
  conflict: 'VAULT_CONFLICT',
} as const;
