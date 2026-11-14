export interface HubOptions {
  /** nmm_ token in, identity out; null = unknown token; throws = control-api unreachable */
  validateMachine(token: string): Promise<{ machineId: string; workspaceId: string } | null>;
  /** clerk bearer + target machine in, membership verdict out; throws = unreachable */
  validateClient(clerkToken: string, machineId: string): Promise<{ allowed: boolean; userId?: string }>;
  log?(line: string): void;
  /** this hub's place among the relay shards (shard.ts): its index, and every shard's URL in shard
   *  order. Absent, or a list of one, = the only relay: every machine is served here */
  shard?: { index: number; urls: readonly string[] };
  /** Fail closed when this process loses its shard lease, including after a CPU pause. */
  canServe?(): boolean;
  /** unidentified sockets (pending.ts): the deadline to attach or say hello (10 s), and how many are held (200) */
  attachDeadlineMs?: number; maxPending?: number;
}
