// Scoped snapshot signing and machine epoch errors.
/** bundle: a repository a person uploaded as a `git bundle` (control-api repo-bundles.ts). The machine
 *  only downloads it, and it is stored raw, not as a zstd tar. */
export type SnapshotKind = 'snapshot' | 'depcache' | 'bundle';
export type SignOp = 'upload' | 'download' | 'exists';

/** A tar archive ends with two 512-byte zero blocks, so a real one is never shorter (GNU tar pads
 *  it to 10 KiB). Fewer bytes means the stream lost its data: the e2e run stored a 9-byte empty
 *  zstd frame as a work snapshot, and the restore that read it back crash-looped. */
export const TAR_MIN_BYTES = 1024;

export interface SignedObject {
  url?: string;
  object?: string;
  size?: number | null;
  exists?: boolean;
}

/** one stored snapshot under the machine's own prefix */
export interface ListedSnapshot { key: string; size: number }

/** null = the object does not exist (download) */
export interface SnapshotSigner {
  sign(kind: SnapshotKind, key: string, op: SignOp): Promise<SignedObject | null>;
  /** the machine's stored snapshots whose key starts with `prefix` (the restore fallback reads it) */
  list?(kind: 'snapshot', prefix: string): Promise<ListedSnapshot[]>;
}

/** nm-api answered 409: a newer epoch owns this machine, and this process must not write */
export class EpochFencedError extends Error {}
/** nm-api answered 401 on a machine route after boot: the token expired, is unknown, or was
 *  replaced. Nothing in this process can recover it. The process exits, Cloud Run restarts the
 *  container, and the new process boots into a new epoch. */
export class MachineTokenRejected extends Error {}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** a list prefix: the start of a key, or empty for all of them */
const PREFIX = /^[A-Za-z0-9._-]{0,64}$/;
export function assertKey(key: string): string {
  if (!KEY.test(key)) throw new Error(`The snapshot key ${key} is not valid.`);
  return key;
}

export function apiSnapshotSigner(opts: {
  apiUrl: string;
  headers: () => Promise<Record<string, string>>;
  epoch: () => number;
  fetchImpl?: typeof fetch;
}): SnapshotSigner {
  const call = opts.fetchImpl ?? fetch;
  return {
    async sign(kind, key, op) {
      const res = await call(`${opts.apiUrl}/v1/machines/snapshots/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await opts.headers()) },
        body: JSON.stringify({ kind, key: assertKey(key), op, epoch: opts.epoch() }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return null;
      if (res.status === 401) throw new MachineTokenRejected(`snapshot ${op} ${kind}/${key}: the machine token was refused`);
      if (res.status === 409) throw new EpochFencedError(`snapshot ${op} ${kind}/${key}: epoch ${opts.epoch()} is stale`);
      if (!res.ok) throw new Error(`snapshot ${op} ${kind}/${key}: HTTP ${res.status}`);
      return (await res.json()) as SignedObject;
    },
    async list(kind, prefix) {
      if (!PREFIX.test(prefix)) throw new Error(`The snapshot prefix ${prefix} is not valid.`);
      const res = await call(`${opts.apiUrl}/v1/machines/snapshots/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await opts.headers()) },
        body: JSON.stringify({ kind, prefix, op: 'list', epoch: opts.epoch() }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 401) throw new MachineTokenRejected(`snapshot list ${kind}/${prefix}: the machine token was refused`);
      if (!res.ok) throw new Error(`snapshot list ${kind}/${prefix}: HTTP ${res.status}`);
      const body = (await res.json()) as { keys?: Array<{ key?: unknown; size?: unknown }> };
      return (body.keys ?? []).flatMap((o) => (typeof o.key === 'string' && KEY.test(o.key) ? [{ key: o.key, size: Number(o.size) || 0 }] : []));
    },
  };
}
