// The renderer's direct line into the RUNNING host (calendar-image-gen round). The host is
// started fire-and-forget from sync.ts and its API lives inside that closure — this slot is
// how an IPC handler reaches one host action without the host growing a global surface.
// The host fills it at boot; before that (or on a machine not running agents) callers get
// the honest refusal below rather than a hang.

export type DraftImageResult = { ok: boolean; thumb?: string; body?: string; error?: string };

export const directActs: {
  draftImage?: (itemId: string, opts: { angle?: string; rewrite?: boolean }) => Promise<DraftImageResult>;
} = {};

export const HOST_NOT_RUNNING = 'the agent host isn’t running on this machine yet — give it a moment after launch and try again';
