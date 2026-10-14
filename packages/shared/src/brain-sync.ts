/** Portable conversation storage. Provider credentials are never part of this contract. */
export interface BrainConversationEvent {
  id: string;
  type: string;
  timestamp: string;
  payload: unknown;
}

export interface BrainCommitRequest {
  workspace: string;
  commitId: string;
  expectedRevision: number;
  deviceId: string;
  events: BrainConversationEvent[];
  runtimeMessages?: unknown[];
  metadata?: Record<string, unknown>;
  artifactIds?: string[];
}

export interface BrainThreadSnapshot {
  workspace: string;
  threadId: string;
  revision: number;
  commitId?: string | null;
  events: BrainConversationEvent[];
  runtimeMessages?: unknown[];
  metadata?: Record<string, unknown>;
  /** the reader named this head with `since`: no events, and nothing else was read */
  unchanged?: true;
}

export interface BrainCommitResult {
  ok: true;
  revision: number;
  commitId: string;
  sha256: string;
  duplicate: boolean;
}
