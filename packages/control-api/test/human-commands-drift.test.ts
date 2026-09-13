// THE PHONE'S COMMANDS CANNOT DRIFT FROM THE SERVER'S (the mobile-cloud round, S1.4).
//
// @neuramesh/shared's HumanCommandSchema is what a client TYPES its payloads against; the server
// validates against its own CommandSchema. A field the client sends that the server never
// declared is a 400 in production and a green build here — unless this test runs: every human
// command must exist server-side under the same type, and every field the client may send must
// be a field the server accepts (a subset is fine; a stranger is not).
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { HumanCommandSchema } from '@neuramesh/shared';
import { CommandSchema } from '../src/commands';

const membersOf = (u: z.ZodDiscriminatedUnion<'type', z.ZodDiscriminatedUnionOption<'type'>[]>) =>
  new Map(u.options.map((o) => [String((o.shape['type'] as z.ZodLiteral<string>).value), o]));

describe('HumanCommandSchema mirrors the server', () => {
  const server = membersOf(CommandSchema as never);
  const client = membersOf(HumanCommandSchema as never);

  it('every client command exists on the server under the same type', () => {
    const missing = [...client.keys()].filter((t) => !server.has(t));
    expect(missing).toEqual([]);
    // the positive control: a scanner that found nothing would pass the assertion above
    expect(client.size).toBeGreaterThan(30);
  });

  it('every field a client may send is a field the server accepts', () => {
    const strangers: string[] = [];
    for (const [type, member] of client) {
      const serverKeys = new Set(Object.keys(server.get(type)!.shape));
      for (const key of Object.keys(member.shape)) if (!serverKeys.has(key)) strangers.push(`${type}.${key}`);
    }
    expect(strangers).toEqual([]);
  });

  it('a sample of each phone command parses server-side', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    const samples: unknown[] = [
      { type: 'workspace.create', name: 'Cobalt Labs', slug: 'cobalt-labs' },
      { type: 'workspace.update', workspace: uuid, activeModelPack: 'starter' },
      { type: 'workspace.accept_invite', invite: uuid },
      { type: 'credential.set', workspace: uuid, provider: 'anthropic', scope: 'workspace', authMode: 'subscription' },
      { type: 'agent.register', workspace: uuid, machineId: uuid, name: 'rex', role: 'orchestrator', model: 'claude-opus-4-8', channels: ['general'] },
      { type: 'member.share_compute', workspace: uuid, member: uuid, on: false },
      { type: 'member.set_compute', workspace: uuid, shares: ['*'] },
      { type: 'thread.set_machine', workspace: uuid, threadId: uuid, machineId: null },
      { type: 'thread.settle', workspace: uuid, threadId: uuid },
      { type: 'schedule.set_status', schedule: uuid, status: 'paused' },
      { type: 'machine.wake', workspace: uuid, machineId: uuid },
      { type: 'code_session.upsert', workspace: uuid, codeSessionId: uuid, repoName: 'nm', branch: 'b', mode: 'plan' },
      { type: 'code_session.close', workspace: uuid, codeSessionId: uuid, state: 'resumable' },
    ];
    for (const s of samples) {
      expect(HumanCommandSchema.safeParse(s).success, `client ${JSON.stringify(s)}`).toBe(true);
      expect(CommandSchema.safeParse(s).success, `server ${JSON.stringify(s)}`).toBe(true);
    }
  });
});
