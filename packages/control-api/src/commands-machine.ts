// The machine commands, spread into CommandSchema (commands.ts sits at its size-ratchet cap, and
// the cloud member kind added three verbs — member-machines round, 2026-09-03).
import { z } from 'zod';
import { CODE_SESSION_COMMANDS } from '@neuramesh/shared';

const runtimes = z.array(z.string().min(1).max(40)).max(12).optional();

export const MACHINE_COMMANDS = [
  z.object({
    type: z.literal('machine.register'),
    workspace: z.string().min(1),
    name: z.string().min(1),
    platform: z.string().min(1).default('darwin'),
    daemonVersion: z.string().min(1).default('0.0.0'),
    transfer: z.boolean().optional(), // Free: re-point this member's single machine to me (the other stops syncing)
    // What this host can actually serve right now — a Claude/Codex/agy login present, or a key
    // available (0114). Published because capability has to be visible ACROSS machines: a host
    // can probe itself, but the origin-affinity policy has to tell "the origin is busy" from
    // "the origin can never run this", and only the origin knows which.
    runtimes,
  }),
  // activeSeconds: real work since the previous beat (bounded — a 30s beat near an hour is a
  // clock bug); busy: work in flight now. Both optional so old daemons keep beating.
  // runtimes: a cloud machine publishes what it can serve on the beat — it never registers, and a
  // login made in its browser terminal must reach the row or the ladder can never choose it
  // while it sleeps (member-machines plan §4).
  z.object({ type: z.literal('machine.heartbeat'), machineId: z.string().min(1), activeSeconds: z.number().int().min(0).max(3600).optional(), busy: z.boolean().optional(), runtimes }),
  // "Add my cloud machine" — self only by construction: the handler writes the actor's own
  z.object({ type: z.literal('machine.provision'), workspace: z.string().min(1) }),
  // the owner's "Remove machine": tombstone → the operator removes workload, Secret and PVC
  z.object({ type: z.literal('machine.remove'), workspace: z.string().min(1), machineId: z.string().uuid() }),
  // wake ONE machine — a person from a surface, or a daemon whose ladder found a lent sleeper
  // forUserId: the member the work came FROM when a daemon asks — the ladder's origin — so a
  // member's own machine wakes for their request even when they lend it to nobody
  z.object({ type: z.literal('machine.wake'), workspace: z.string().min(1), machineId: z.string().uuid(), forUserId: z.string().uuid().optional() }),
  // the Code-session rows a host and a client keep (commands-code.ts) ride the same spread
  ...CODE_SESSION_COMMANDS,
] as const;
