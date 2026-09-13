// FAILURE ALERTS (docs/design/failure-alerts-2026-08) — the attention bar's one derivation.
//
// The bar is DERIVED, never stored: it renders from three synced row conditions and disappears
// the moment each condition clears. No ack table, no unread state, no agent in the loop — this
// module is pure so the Home bar, the bell section, and the tests cannot disagree about what
// deserves attention. Detection is code; rex's triage (stall watchdog) is judgment on top.
//
// ONE amendment (2026-08-20, George: fixed failures kept haunting the bar): failed POSTS accept
// a per-group dismissal WATERMARK — "everything scheduled up to this moment, I've seen". A post
// stays a failed row (the calendar keeps its amber chip; nothing is deleted or hushed), it just
// stops occupying the attention bar; any failure scheduled AFTER the watermark re-raises the
// group. The watermark is an INPUT so this module stays pure — the desktop keeps it in
// localStorage (a personal attention surface, machine-local by design, no schema). Connectors
// and routines are NOT dismissible: their fix actions (Reconnect, Pause) are their mutes.
//
// Inputs mirror the replica rows the nm:alerts IPC selects (snake_case on purpose). Conditions
// are re-checked HERE, defensively — a caller may pass broader sets (the preview harness does).

export interface AlertConnectorRow {
  id: string;
  provider: string;
  handle: string;
  /** only 'reauth_required' (the server's dead-grant verdict, 0121) alerts — a human's
   *  deliberate 'revoked' must never nag */
  status: string;
  project_id: string | null;
  project_name: string | null;
  /** a room of the connector's project — the reconnect round-trip and every navigation anchor */
  channel_id: string | null;
}

export interface AlertScheduleRow {
  id: string;
  title: string;
  status: string; // only 'active' rows alert — pausing IS the human's mute
  last_error: string | null;
  last_run_at: string | null;
  channel_id: string;
  channel_slug: string | null;
  project_id: string | null;
  project_name: string | null;
}

export interface AlertPostRow {
  id: string;
  platform: string;
  status: string; // only 'failed' rows alert
  last_error: string | null;
  scheduled_at: string | null;
  channel_id: string;
  channel_slug: string | null;
  project_id: string | null;
  project_name: string | null;
}

export interface Alert {
  kind: 'connector' | 'routine' | 'posts' | 'compute';
  /** stable render key (also the refire identity if a surface ever wants one) */
  key: string;
  title: string;
  /** the collapsed bar's fragment — a few words, joined with ' · ' */
  short: string;
  /** the verbatim last_error where one exists — the truth, never a paraphrase */
  why: string;
  /** where it lives: "Project · #room" (parts that exist) */
  meta: string;
  channelId: string | null;
  provider?: string;
  scheduleId?: string;
  count?: number;
  /** posts folded under a connector alert for the same project+platform: same cause, one card —
   *  the group keeps "Review on calendar" and never grows a second Reconnect */
  linked?: boolean;
}

const PROVIDER_LABEL: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', email: 'Email' };
export const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? p;

const metaOf = (projectName: string | null, channelSlug: string | null): string =>
  [projectName, channelSlug ? `#${channelSlug}` : null].filter(Boolean).join(' · ');

export function deriveAlerts(
  connectors: AlertConnectorRow[],
  schedules: AlertScheduleRow[],
  posts: AlertPostRow[],
  /** posts-group key → ISO watermark: failures scheduled at-or-before it stay off the bar */
  dismissals: Record<string, string> = {},
): Alert[] {
  const out: Alert[] = [];

  const reauth = connectors.filter((c) => c.status === 'reauth_required');
  for (const c of reauth) {
    const label = providerLabel(c.provider);
    out.push({
      kind: 'connector',
      key: `connector:${c.id}`,
      title: `${label}${c.handle ? ` (${c.handle})` : ''} needs re-authorizing`,
      short: `${label}${c.project_name ? ` for ${c.project_name}` : ''} needs re-authorizing`,
      why: `${label} refused the stored authorization — reconnect it, then re-approve anything it was holding.`,
      meta: metaOf(c.project_name, null),
      channelId: c.channel_id,
      provider: c.provider,
    });
  }

  for (const s of schedules.filter((r) => r.status === 'active' && !!r.last_error)) {
    out.push({
      kind: 'routine',
      key: `routine:${s.id}`,
      title: `Routine “${s.title}” failed its last run`,
      short: `${s.title} failing`,
      why: s.last_error!,
      meta: metaOf(s.project_name, s.channel_slug),
      channelId: s.channel_id,
      scheduleId: s.id,
    });
  }

  // failed posts group by (project × platform): one slot's outage is one card, not N chips —
  // and when the matching connector is itself dead, the group is the SAME failure seen twice,
  // so it folds under the connector card instead of repeating the reason beside it.
  const groups = new Map<string, AlertPostRow[]>();
  for (const p of posts.filter((r) => r.status === 'failed')) {
    const k = `${p.project_id ?? p.channel_id}:${p.platform}`;
    // a null scheduled_at never dismisses — conservative: an oddly-shaped failure keeps showing
    const wm = dismissals[`posts:${k}`];
    if (wm && p.scheduled_at && p.scheduled_at <= wm) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(p);
  }
  for (const [k, rows] of groups) {
    const first = rows[0]!;
    const label = providerLabel(first.platform);
    const linked = reauth.some((c) => c.provider === first.platform && (c.project_id ?? '') === (first.project_id ?? ''));
    const n = rows.length;
    out.push({
      kind: 'posts',
      key: `posts:${k}`,
      title: `${n} ${label} post${n === 1 ? '' : 's'} didn’t go out`,
      short: `${n} post${n === 1 ? '' : 's'} didn’t go out`,
      why: linked
        ? `failed on the ${label} account above — reconnect it, then re-approve them from the calendar.`
        : (first.last_error ?? 'the publish pass could not send them — open the calendar for each post’s reason.'),
      meta: metaOf(first.project_name, first.channel_slug),
      channelId: first.channel_id,
      provider: first.platform,
      count: n,
      linked,
    });
  }

  // compute outranks everything: a dead connector is worth fixing, but while no machine can
  // run, none of the other fixes can even be carried out.
  const rank = { compute: 0, connector: 1, routine: 2, posts: 3 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || (b.count ?? 0) - (a.count ?? 0) || a.title.localeCompare(b.title));
}

/** The collapsed bar's one line: every alert's short fragment, in rank order. */
export const alertsSummary = (alerts: Alert[]): string => alerts.map((a) => a.short).join(' · ');

/**
 * THE CAP, ON THE ATTENTION BAR (cloud-cap round, 2026-08-29).
 *
 * The other three alerts are folded from SYNCED ROWS, which is why they live in deriveAlerts. The
 * cap is not a row: it is the derived state of a machine, read over HTTP because the fleet's
 * intent is outside the sync publication. Forcing it through deriveAlerts would mean handing that
 * pure function a fourth input it cannot get from the same place as the other three, so it gets
 * its own derivation and the bar simply renders one more Alert.
 *
 * It exists because the cap can be reached while nobody is in a thread: the sweep stops the
 * machine mid-afternoon, and the gate card only speaks to somebody who is already typing. This is
 * the line for the person who was not looking.
 */
export function computeAlert(state: {
  status: string; reason: string; minutes: number; capMinutes: number | null;
} | null): Alert | null {
  if (!state || state.status !== 'capped') return null;
  return {
    kind: 'compute',
    key: 'compute:capped',
    title: 'Free machine hours used up',
    short: 'Free machine hours used up',
    // the reason is already written for a person by machineState, so the bar does not rewrite it
    why: state.reason,
    meta: `${state.minutes} of ${state.capMinutes ?? 0} min used today`,
    channelId: null,
  };
}
