// The errors a cloud machine's API calls throw. Public, because the approval parks (hooks/parks.ts)
// and the shared facts (harness/facts.ts) read them on every host.

/** nm-api answered 409: a newer epoch owns this machine, and this process must not write */
export class EpochFencedError extends Error {}
/** nm-api answered 401 on a machine route after boot: the token expired, is unknown, or was
 *  replaced. Nothing in this process can recover it. The process exits, Cloud Run restarts the
 *  container, and the new process boots into a new epoch. */
export class MachineTokenRejected extends Error {}
