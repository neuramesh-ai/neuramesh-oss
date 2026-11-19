export interface RelayConfig {
  /** Explicit across JavaScript realms (React Native -> terminal WebView). */
  joiningDeadlineMs?: number;
  /** wss origin of the relay, e.g. wss://relay.neuramesh.app, or the relay shards as a comma list in
   *  shard order (@neuramesh/relay shard.ts). One URL is one shard */
  relayUrl: string;
  /** live client attach credential. Production supplies a Clerk session token; the local
   *  harness supplies its explicitly-gated dev identity token without leaking that token into
   *  normal /v1 API Authorization headers. */
  clientBearer(): Promise<string | null>;
  /** the workspace's runner id; null when there is none yet (never woken). ASYNC because
   *  resolving it is an HTTP read, and a terminal that opens before the answer arrives is
   *  better than one that refuses because the answer had not been cached yet. */
  machineId(): Promise<string | null>;
  /** how long the sessions of a dropped socket wait for this client to attach again before each
   *  pane hears that the connection is gone. Default RESUME_WINDOW_MS, inside the machine's own grace
   *  (NM_RELAY_RESUME_GRACE_MS, 120 s), so the machine still holds what the client comes back for */
  resumeWindowMs?: number;
  /** when this client replaces its own socket, before the relay's request timeout (3600 s on Cloud
   *  Run) cuts it. Jittered by 10 %. 0 = never. Default ROTATE_MS. Only against a machine that resumes */
  rotateMs?: number;
}
