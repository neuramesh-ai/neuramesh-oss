import { cardNotification, isLowRiskPermissionCard, parseCard, reviewPushFor } from '@neuramesh/shared';
import type { Store } from './store';

// Server-side push fan-out for the mobile companion. Fires when a task reaches a
// human gate or an agent posts a decision card, to every human member of the
// workspace except the actor. The payload is render-ready (iOS can't background-sync
// PowerSync) and carries deep-link ids. The actual Expo transport is injectable so
// the decision logic (recipients, dedupe, copy, dead-token revocation) unit-tests
// without the network.

const GATE_STATES = new Set(['done', 'design_review', 'plan_review', 'ship_review', 'blocked']);
// the lane's default: the same event twice inside a minute is one push (a double-fired command)
const DEDUPE_WINDOW_MS = 60_000;
// THE REMINDER'S WINDOW (2026-09-08). The review reminder rides a cron that fires every MINUTE with a
// THIRTY-minute lead, so the lane's minute-long default let it through again on every run: the same
// "X post publishes at 15:30" landed on George's lock screen every other minute for half an hour.
// One reminder per post per scheduled time is the contract, so its window outlives any lead by far;
// the key carries the scheduled minute, so a rescheduled post still earns its one.
const REVIEW_DEDUPE_WINDOW_MS = 7 * 24 * 3_600_000;

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
}

// One ticket per message, index-aligned with the request (Expo's contract).
export interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export interface PushSender {
  send(messages: ExpoPushMessage[]): Promise<ExpoTicket[]>;
}

// The copy each human gate shows on the lock screen.
function gateNotification(task: { number: number; title: string; state: string; planApprovedAt?: string | null }): { title: string; body: string } | null {
  switch (task.state) {
    case 'done':
      return { title: `Ready to accept · #${task.number}`, body: `"${task.title}" passed review — accept to merge.` };
    case 'design_review':
      return { title: `Design review · #${task.number}`, body: `"${task.title}" — a design round is waiting for your approval.` };
    case 'plan_review':
      // born-approved units (a routine's hands-off create, 2026-08-19) rest in plan_review
      // with the stamp already set — there is no plan to review, so there is no push
      if (task.planApprovedAt) return null;
      return { title: `Plan ready · #${task.number}`, body: `"${task.title}" — review the plan.` };
    case 'ship_review':
      return { title: `Release plan ready · #${task.number}`, body: `"${task.title}" — approve the release plan to arm the checklist.` };
    case 'blocked':
      return { title: `Blocked · #${task.number}`, body: `"${task.title}" is blocked and needs you.` };
    default:
      return null;
  }
}

export class PushService {
  constructor(
    private readonly store: Store,
    private readonly sender: PushSender,
  ) {}

  // A task transitioned — push if it landed on a human gate.
  async notifyTaskGate(
    task: { id: string; number: number; title: string; state: string; workspace: string; channel: string; planApprovedAt?: string | null },
    actorId: string,
  ): Promise<void> {
    if (!GATE_STATES.has(task.state)) return;
    const notif = gateNotification(task);
    if (!notif) return;
    await this.dispatch({
      workspace: task.workspace,
      excludeUserId: actorId,
      dedupeKey: `gate:${task.id}:${task.state}`,
      title: notif.title,
      body: notif.body,
      data: { channelId: task.channel, taskId: task.id, workspace: task.workspace },
    });
  }

  /**
   * THE REVIEW REMINDER (George, 2026-09-07). A scheduled post lands in half an hour and this is
   * the last moment a person can change their mind about it. Every human in the workspace is told,
   * with no `excludeUserId`: a post is the workspace's, and whoever scheduled it is exactly the
   * person who might want a second look.
   *
   * The words come from the pure rule in @neuramesh/shared, and `dedupeKey` is what makes a cron
   * that runs every minute send exactly one — "already reminded" is a fact of this lane, so the
   * feature needs no column and no migration.
   */
  async notifyPostReview(
    item: { id: string; workspace: string; channel: string; threadId: string | null; platform: string; body: string; scheduledAt: string },
    now: Date,
  ): Promise<void> {
    const push = reviewPushFor({ id: item.id, platform: item.platform, body: item.body, at: new Date(item.scheduledAt) }, now);
    if (!push) return;
    await this.dispatch({
      workspace: item.workspace,
      excludeUserId: '',
      dedupeKey: push.dedupeKey,
      windowMs: REVIEW_DEDUPE_WINDOW_MS,
      title: push.title,
      body: push.body,
      data: { contentItemId: item.id, channelId: item.channel, threadId: item.threadId, workspace: item.workspace },
    });
  }

  /**
   * The routine's ONE notification (2026-08-19): the run finished — no gate, no ask. The human
   * opens the thread to read what it produced; nothing is waiting on them.
   */
  async notifyRoutineDone(
    task: { id: string; number: number; title: string; workspace: string; channel: string },
  ): Promise<void> {
    await this.dispatch({
      workspace: task.workspace,
      // nobody is excluded: the accept came from the server, not from any human's device
      excludeUserId: '',
      dedupeKey: `routine-done:${task.id}`,
      title: `Routine finished · #${task.number}`,
      body: `"${task.title}" ran to completion — open the thread to see the run.`,
      data: { channelId: task.channel, taskId: task.id, workspace: task.workspace },
    });
  }

  // An agent posted a message — push if it carries an nmq/nmauth decision card.
  async notifyCardMessage(
    msg: { id: string; workspace: string; channelId: string; taskId: string | null; threadId?: string | null; authorKind: string; authorId: string; body: string },
    where: string,
  ): Promise<void> {
    if (msg.authorKind !== 'agent') return;
    if (!parseCard(msg.body)) return;
    // Routine (low-risk) permission approvals surface in-app only — no lock-screen push, to
    // avoid the notification fatigue Conseca warns about. High-risk asks + ordinary questions push.
    if (isLowRiskPermissionCard(msg.body)) return;
    const notif = cardNotification(msg.body, where);
    if (!notif) return;
    await this.dispatch({
      workspace: msg.workspace,
      excludeUserId: msg.authorId,
      dedupeKey: `card:${msg.id}`,
      title: notif.title,
      body: notif.body,
      data: { channelId: msg.channelId, taskId: msg.taskId, threadId: msg.threadId ?? null, messageId: msg.id, workspace: msg.workspace },
    });
  }

  /**
   * A CODE APPROVAL IS WAITING (the mobile-cloud round, S0.3). A Code session is one member's,
   * so this reaches exactly that member — never the whole workspace — and dedupes per approval.
   * The host that raised it is the one that knows; the server decides who is told.
   */
  async notifyCodeApproval(s: {
    codeSessionId: string; workspace: string; ownerUserId: string; title: string; machineName: string | null;
    approvalId: string; category: string; toolName: string;
  }): Promise<void> {
    const what = { read: 'Read files', edit: 'Edit files', command: 'Run a command', web: 'Fetch the web', mcp: 'Use a tool' }[s.category] ?? 'Approve';
    await this.dispatch({
      workspace: s.workspace,
      excludeUserId: '',
      recipients: [s.ownerUserId],
      dedupeKey: `code-approval:${s.codeSessionId}:${s.approvalId}`,
      title: `Approval needed · ${s.title || 'Code session'}`,
      body: `${what} · ${s.toolName}${s.machineName ? ` on ${s.machineName}` : ''}`,
      data: { codeSessionId: s.codeSessionId, workspace: s.workspace },
    });
  }

  private async dispatch(p: {
    workspace: string;
    excludeUserId: string;
    /** name the recipients outright (a Code session is one member's); absent = every human member but the actor */
    recipients?: string[];
    dedupeKey: string;
    /** how long the key holds — the lane's minute by default; a reminder holds for days */
    windowMs?: number;
    title: string;
    body: string;
    data: Record<string, unknown>;
  }): Promise<void> {
    const members = p.recipients ?? (await this.store.humanMemberIds(p.workspace)).filter((id) => id !== p.excludeUserId);
    if (members.length === 0) return;
    // per-recipient dedupe: skip anyone already pushed for this event in the window
    const recipients: string[] = [];
    for (const id of members) {
      if (await this.store.recordPushOnce(id, p.dedupeKey, p.windowMs ?? DEDUPE_WINDOW_MS)) recipients.push(id);
    }
    if (recipients.length === 0) return;
    const devices = await this.store.devicesForUsers(recipients);
    if (devices.length === 0) return;
    const messages: ExpoPushMessage[] = devices.map((d) => ({ to: d.token, title: p.title, body: p.body, data: p.data, sound: 'default' }));
    const tickets = await this.sender.send(messages);
    // retire tokens Expo reports as dead so we stop pushing to uninstalled apps
    await Promise.all(
      tickets.map((t, i) => {
        if (t.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
          const dead = devices[i];
          if (dead) return this.store.revokeDeviceToken(dead.token);
        }
        return Promise.resolve();
      }),
    );
  }
}

/**
 * WHAT A LANDED COMMAND PUSHES — the one hook /v1/commands runs after executeCommand. A task on
 * a human gate pushes the gate (a routine's own auto-accept pushes "finished" instead), and a
 * Code session's approval pushes its member. Fire-and-forget: a push never fails a command.
 */
export function pushAfterCommand(push: PushService, actorId: string, cmd: { type: string }, outcome: unknown): void {
  const o = outcome as { task?: Parameters<PushService['notifyTaskGate']>[0]; events?: Array<{ type: string; payload?: unknown }> } & Partial<Parameters<PushService['notifyCodeApproval']>[0]>;
  if (cmd.type === 'code_session.approval_waiting' && o.ownerUserId && o.codeSessionId) {
    void push.notifyCodeApproval(o as Parameters<PushService['notifyCodeApproval']>[0]).catch(() => {});
    return;
  }
  if (!o.task) return;
  // a routine's auto-accept (handler.ts, 2026-08-19) is the one accepted that notifies: "finished,
  // come read it" — never a gate, so it bypasses gateNotification entirely
  const routineDone = Array.isArray(o.events) && o.events.some((e) => e.type === 'task.accepted' && (e.payload as { routine?: boolean } | null)?.routine);
  if (routineDone) void push.notifyRoutineDone(o.task).catch(() => {});
  else void push.notifyTaskGate(o.task, actorId).catch(() => {});
}

// Expo Push transport over raw fetch (no SDK dependency — mirrors how clerk.ts calls
// external APIs, and keeps the Vercel bundle unchanged). Chunks at Expo's 100/request
// limit. The access token is optional (enhanced-security projects set it).
export function expoFetchSender(accessToken?: string): PushSender {
  return {
    async send(messages: ExpoPushMessage[]): Promise<ExpoTicket[]> {
      const out: ExpoTicket[] = [];
      for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        try {
          const res = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'application/json',
              ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
            },
            body: JSON.stringify(chunk),
            signal: AbortSignal.timeout(10_000),
          });
          const body = (await res.json().catch(() => ({}))) as { data?: ExpoTicket[] };
          out.push(...(body.data ?? chunk.map(() => ({ status: 'error' as const, message: `expo push failed (${res.status})` }))));
        } catch {
          out.push(...chunk.map(() => ({ status: 'error' as const, message: 'expo push request failed' })));
        }
      }
      return out;
    },
  };
}
