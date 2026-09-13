// Multi-workspace membership + answered invitations (0113) against the REAL schema.
//
// What this locks down, all of it previously broken or impossible:
//   · signing in no longer creates a membership as a side effect — accepting does
//   · you cannot answer an invitation addressed to someone else
//   · one person can belong to TWO workspaces (the schema always allowed it; nothing exercised it)
//   · declining frees the address, so a re-invite is not a 23505 on the partial unique index
//   · the free seat cap is re-counted at ACCEPT, not just at invite
//   · leave / remove_member exist, with the owner rules that keep a workspace from being stranded
//   · account deletion unblocks once you leave — one accepted invite used to wedge it forever
//
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';

const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}

/** A real nm_users row — the identity accept_invite re-reads the address from. */
async function makeUser(clerkId: string, email: string): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}

/** A second workspace owned by `owner`, so the multi-membership cases have somewhere to go. */
async function makeWorkspace(name: string, owner: Actor): Promise<string> {
  const [ws] = await sql!`insert into workspaces (name, slug, created_by, plan)
    values (${name}, ${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}, ${owner.id}::uuid, 'cloud') returning id`;
  const id = ws!['id'] as string;
  await sql!`insert into workspace_members (workspace_id, user_id, role) values (${id}::uuid, ${owner.id}::uuid, 'owner')
    on conflict do nothing`;
  return id;
}

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('invitations are answered, not claimed (0113)', () => {
  it('signing in surfaces an invitation but joins nobody; accepting is what creates the membership', async () => {
    await store!.setWorkspacePlan(WS, { plan: 'cloud' }); // seat cap has its own test below
    const invitee = await makeUser('clerk_answer', 'answer@acme.dev');
    await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'answer@acme.dev' }));

    // READ: the invitation is visible to them...
    const waiting = await store!.pendingInvitesForEmail('ANSWER@acme.dev'); // case-insensitive
    expect(waiting.map((i) => i.workspaceId)).toContain(WS);
    // ...and reading it joined them to nothing. This is the whole behaviour change.
    const [before] = await sql!`select count(*) as n from workspace_members
      where workspace_id = ${WS}::uuid and user_id = ${invitee.id}::uuid`;
    expect(Number(before!['n'])).toBe(0);

    expect((await send(invitee, { type: 'workspace.accept_invite', invite: waiting[0]!.inviteId })).status).toBe(200);
    const [after] = await sql!`select count(*) as n from workspace_members
      where workspace_id = ${WS}::uuid and user_id = ${invitee.id}::uuid`;
    expect(Number(after!['n'])).toBe(1);
  });

  it('you cannot accept an invitation addressed to someone else', async () => {
    const target = 'victim@acme.dev';
    const attacker = await makeUser('clerk_attacker', 'attacker@evil.dev');
    const inv = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: target }));

    // the attacker holds the invite id — it travels through an inbox and a URL, so it must not
    // be sufficient on its own
    const res = await send(attacker, { type: 'workspace.accept_invite', invite: inv.inviteId });
    expect(res.status).toBe(404);
    const [n] = await sql!`select count(*) as n from workspace_members
      where workspace_id = ${WS}::uuid and user_id = ${attacker.id}::uuid`;
    expect(Number(n!['n'])).toBe(0);
    // still open for the person it was actually sent to
    expect((await store!.pendingInvitesForEmail(target)).length).toBe(1);
  });

  it('an agent can never answer an invitation', async () => {
    const inv = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'agentbait@acme.dev' }));
    expect((await send(rex, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(403);
    expect((await send(rex, { type: 'workspace.decline_invite', invite: inv.inviteId })).status).toBe(403);
  });

  it('declining frees the address — re-inviting someone who said no is a normal act', async () => {
    const decliner = await makeUser('clerk_decliner', 'decliner@acme.dev');
    const first = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'decliner@acme.dev' }));
    expect((await send(decliner, { type: 'workspace.decline_invite', invite: first.inviteId })).status).toBe(200);

    const [row] = await sql!`select status, declined_at from workspace_invites where id = ${first.inviteId}::uuid`;
    expect(row!['status']).toBe('declined');
    expect(row!['declined_at']).toBeTruthy();
    expect(await store!.pendingInvitesForEmail('decliner@acme.dev')).toHaveLength(0);

    // the partial unique index is on status='pending', so a declined row does not block a new one
    const second = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'decliner@acme.dev' }));
    expect(second.inviteId).not.toBe(first.inviteId);
    expect(await store!.pendingInvitesForEmail('decliner@acme.dev')).toHaveLength(1);
  });

  it('a declined invitation cannot then be accepted', async () => {
    const u = await makeUser('clerk_flip', 'flip@acme.dev');
    const inv = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'flip@acme.dev' }));
    expect((await send(u, { type: 'workspace.decline_invite', invite: inv.inviteId })).status).toBe(200);
    expect((await send(u, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(404);
  });
});

describe.skipIf(!DB)('one person, two workspaces', () => {
  it('belongs to both, and neither membership disturbs the other', async () => {
    const dual = await makeUser('clerk_dual', 'dual@acme.dev');
    const other = await makeWorkspace('Northwind PG', george);

    for (const ws of [WS, other]) {
      const inv = await j(await send(george, { type: 'workspace.invite', workspace: ws, email: 'dual@acme.dev' }));
      expect((await send(dual, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
    }

    const mine = await store!.listWorkspaces(dual.id);
    expect(mine.map((w) => w.id).sort()).toEqual([WS, other].sort());
    // ordered by created_at — this is exactly what made the desktop's `resolved[0]` pick
    // relocate people; the client-side fix is covered in apps/desktop wsident.test.ts
    expect(mine.length).toBe(2);
  });

  it('an invitation to a workspace you are ALREADY in is refused', async () => {
    const already = await makeUser('clerk_already', 'already@acme.dev');
    const inv = await j(await send(george, { type: 'workspace.invite', workspace: WS, email: 'already@acme.dev' }));
    expect((await send(already, { type: 'workspace.accept_invite', invite: inv.inviteId })).status).toBe(200);
    // 409, not 502: a permanent state of the world, so the client must not read it as a
    // retryable upstream hiccup
    const again = await send(george, { type: 'workspace.invite', workspace: WS, email: 'already@acme.dev' });
    expect(again.status).toBe(409);
    expect((await j(again)).error).toMatch(/already a member/i);
  });
});

describe.skipIf(!DB)('the seat cap holds at accept, not just at invite', () => {
  it('an invitation that sat pending while the workspace filled is refused with PLAN_LIMIT', async () => {
    const owner = await makeUser('clerk_capowner', 'capowner@acme.dev');
    const ws = await makeWorkspace('Cap PG', owner); // Team — invitations go out freely

    const inv = await j(await send(owner, { type: 'workspace.invite', workspace: ws, email: 'late@acme.dev' }));
    expect(inv.inviteId).toBeTruthy();

    // the workspace drops to Free while the invitation sits in an inbox: one person only
    await sql!`update workspaces set plan = 'free' where id = ${ws}::uuid`;

    const late = await makeUser('clerk_late', 'late@acme.dev');
    const res = await send(late, { type: 'workspace.accept_invite', invite: inv.inviteId });
    expect(res.status).toBe(402);
    expect((await j(res)).code).toBe('PLAN_LIMIT');
    const [n] = await sql!`select count(*) as n from workspace_members where workspace_id = ${ws}::uuid`;
    expect(Number(n!['n'])).toBe(1); // the cap held; the second seat was never granted
  });

  it('a Free workspace cannot issue an invitation at all — the invitation is the upgrade door', async () => {
    const owner = await makeUser('clerk_soloowner', 'soloowner@acme.dev');
    const ws = await makeWorkspace('Solo PG', owner);
    await sql!`update workspaces set plan = 'free' where id = ${ws}::uuid`;
    const res = await send(owner, { type: 'workspace.invite', workspace: ws, email: 'second@acme.dev' });
    expect(res.status).toBe(402);
    expect((await j(res)).error).toMatch(/Upgrade to Pro/);
  });
});

describe.skipIf(!DB)('leaving and removing (the exits that did not exist)', () => {
  it('a member can leave; the owner cannot', async () => {
    const owner = await makeUser('clerk_leaveowner', 'leaveowner@acme.dev');
    const ws = await makeWorkspace('Leave PG', owner);
    const member = await makeUser('clerk_leaver', 'leaver@acme.dev');
    const inv = await j(await send(owner, { type: 'workspace.invite', workspace: ws, email: 'leaver@acme.dev' }));
    await send(member, { type: 'workspace.accept_invite', invite: inv.inviteId });

    // the owner is refused — a workspace with no owner has nobody who can delete or bill it
    const ownerLeave = await send(owner, { type: 'workspace.leave', workspace: ws });
    expect(ownerLeave.status).toBe(403);
    expect((await j(ownerLeave)).error).toMatch(/own this workspace/i);

    expect((await send(member, { type: 'workspace.leave', workspace: ws })).status).toBe(200);
    const [n] = await sql!`select count(*) as n from workspace_members where workspace_id = ${ws}::uuid`;
    expect(Number(n!['n'])).toBe(1);
    // leaving twice is a clean 404, not a crash
    expect((await send(member, { type: 'workspace.leave', workspace: ws })).status).toBe(404);
  });

  it('owners/admins remove others; nobody removes the owner or themselves', async () => {
    const owner = await makeUser('clerk_rmowner', 'rmowner@acme.dev');
    const ws = await makeWorkspace('Remove PG', owner);
    const member = await makeUser('clerk_rmmember', 'rmmember@acme.dev');
    const inv = await j(await send(owner, { type: 'workspace.invite', workspace: ws, email: 'rmmember@acme.dev' }));
    await send(member, { type: 'workspace.accept_invite', invite: inv.inviteId });

    // a plain member cannot remove anyone
    expect((await send(member, { type: 'workspace.remove_member', workspace: ws, member: owner.id })).status).toBe(403);
    // ...and the owner is not removable even by themselves-as-owner
    const self = await send(owner, { type: 'workspace.remove_member', workspace: ws, member: owner.id });
    expect(self.status).toBe(403);
    expect((await j(self)).error).toMatch(/use leave/i);

    expect((await send(owner, { type: 'workspace.remove_member', workspace: ws, member: member.id })).status).toBe(200);
    const [n] = await sql!`select count(*) as n from workspace_members where workspace_id = ${ws}::uuid`;
    expect(Number(n!['n'])).toBe(1);
  });

  it('account deletion unblocks once you leave — one accepted invite used to wedge it forever', async () => {
    const guest = await makeUser('clerk_guest', 'guest@acme.dev');
    const host = await makeUser('clerk_host', 'host@acme.dev');
    const ws = await makeWorkspace('Guest PG', host);
    const inv = await j(await send(host, { type: 'workspace.invite', workspace: ws, email: 'guest@acme.dev' }));
    await send(guest, { type: 'workspace.accept_invite', invite: inv.inviteId });

    // blocked while the membership stands — and before 0113 there was no way out of this state
    await expect(store!.deleteAccount(guest.id)).rejects.toThrow(/leave or delete/i);
    expect((await send(guest, { type: 'workspace.leave', workspace: ws })).status).toBe(200);
    await expect(store!.deleteAccount(guest.id)).resolves.toBeUndefined();
  });
});
