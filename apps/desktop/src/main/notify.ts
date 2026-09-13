// Desktop push notifications (Feature A). The user often works in another app while their agent
// team runs — when something needs THEM (an agent's question card, an auth reconnect, a task ready
// to accept), fire a native OS notification. Clicking it focuses NeuraMesh and deep-links to the
// exact thread. We only fire when the window is unfocused so the user isn't pinged about something
// they're already looking at. Watches the local synced replica — no polling, no network, works
// offline. The OS-specific bits (window focus, the Notification itself) are INJECTED so this module
// is pure and unit-testable; sync.ts supplies the electron implementations.
export interface OpenThreadNav { channelId: string; taskId: string | null; messageId: string }
export type Notifier = (n: { title: string; body: string; nav: OpenThreadNav }) => void;

export interface NotifyDeps {
  isFocused: () => boolean; // is the app window currently focused?
  notifier: Notifier; // show the native notification (and wire its click → open-thread)
  supported?: () => boolean; // is OS notification support available? default: yes
}

// minimal shape of the PowerSync handle we use (avoids a hard dep — keeps the module test-friendly)
type WatchResult = { rows?: { _array?: unknown[] } };
export interface WatchableDb {
  watch(sql: string, params: unknown[], cb: { onResult: (r: WatchResult) => void; onError: (e: unknown) => void }): void;
}

let enabled = true; // gated by the in-app toggle (nm:notify-set-enabled); default on
export function setNotificationsEnabled(on: boolean): void { enabled = on; }
export function notificationsEnabled(): boolean { return enabled; }

// readable one-liner for the notification body: drop fenced blocks + markdown emphasis, first line.
export function preview(body: string): string {
  const line = body.replace(/```[\s\S]*?```/g, '').replace(/[*_`#>]/g, '').split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  return line.slice(0, 140);
}

// Does an agent message need the human's attention? An nmq decision card (question / plan approval /
// "add @agent?" / project confirm) or an nmauth reconnect card. Returns the notification, or null.
export function needsHumanMessage(m: { author_kind: string; body: string; slug: string; number: number | null }): { title: string; body: string } | null {
  if (m.author_kind !== 'agent') return null;
  const isAuth = /```nmauth/.test(m.body);
  const isCard = isAuth || /```nmq/.test(m.body);
  if (!isCard) return null;
  const where = m.number ? `#${m.number}` : `#${m.slug}`;
  return { title: isAuth ? `Action needed · ${where}` : `A question for you · ${where}`, body: preview(m.body) || 'Open NeuraMesh to respond' };
}

type MsgRow = { id: string; channel_id: string; task_id: string | null; author_kind: string; body: string; slug: string; number: number | null };
type DoneRow = { id: string; number: number; title: string; channel_id: string };

// Start the two watches. Lives for the app's lifetime; fires `deps.notifier` (only when unfocused +
// enabled + supported). Pure given its deps — the unit test drives it with a fake db + spy notifier.
export function startNotifications(db: WatchableDb, deps: NotifyDeps): void {
  const supported = deps.supported ?? (() => true);
  if (!supported()) return;
  const seen = new Set<string>();

  const fire = (title: string, body: string, nav: OpenThreadNav) => {
    if (!enabled || !supported() || deps.isFocused()) return; // don't ping what they're already looking at
    deps.notifier({ title, body, nav });
  };

  // 1) agent messages that need the human (nmq / nmauth). The query filters to created_at > the app
  //    start, so existing history never pings; dedup by message id for re-fires of the same window.
  db.watch(
    `select m.id, m.channel_id, m.task_id, m.author_kind, m.body, c.slug, t.number
       from messages m join channels c on c.id = m.channel_id
       left join tasks t on t.id = m.task_id
      where m.created_at > ? order by m.created_at desc limit 25`,
    [new Date().toISOString()],
    {
      onResult: (r) => {
        for (const m of (r.rows?._array ?? []) as MsgRow[]) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          const n = needsHumanMessage(m);
          if (n) fire(n.title, n.body, { channelId: m.channel_id, taskId: m.task_id, messageId: m.id });
        }
      },
      onError: () => {},
    },
  );

  // 2) a task reaching 'done' — reviewed and awaiting the human's acceptance ("accept a completed
  //    task"). Baseline the already-done set on the first tick so only NEW transitions ping.
  let baseline: Set<string> | null = null;
  db.watch(
    `select id, number, title, channel_id from tasks where state = 'done'`,
    [],
    {
      onResult: (r) => {
        const rows = (r.rows?._array ?? []) as DoneRow[];
        if (baseline === null) { baseline = new Set(rows.map((x) => x.id)); return; }
        for (const t of rows) {
          if (baseline.has(t.id)) continue;
          baseline.add(t.id);
          fire(`Task #${t.number} is ready to accept`, `"${t.title}" passed review — accept it to merge.`, { channelId: t.channel_id, taskId: t.id, messageId: '' });
        }
      },
      onError: () => {},
    },
  );
}
