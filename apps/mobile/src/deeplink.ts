// WHERE A TAP LANDS (the mobile-cloud round S7, D12): a notification is not a destination — every
// push carries the id of the surface it is about, and this is the ONE mapping from that payload to
// a route. Pure, so it is tested without a device: the simulator cannot receive a push at all.
//
// Precedence is specificity: a Code approval names its session; a task's gate or card names the
// task (its screen shows the thread and the card); a chat's card names the thread; a room-only
// payload opens the room's session list; a machine event opens Compute. The same routes answer
// the `neuramesh://` scheme by construction (expo-router maps `neuramesh://thread/<id>` to
// `/thread/[id]`), so a link in an email or on the web lands on the identical screen.
export interface DeepLink {
  workspace?: string;
  channelId?: string | null;
  taskId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  /** a Code approval waiting (S0.3 · notifyCodeApproval) */
  codeSessionId?: string | null;
  /** a scheduled post about to publish (the 30-minute review reminder) — lands on the post itself */
  contentItemId?: string | null;
  /** a machine event — woke · capped · out of credits — lands on Compute */
  machineId?: string | null;
  /** a payload that names its screen outright */
  route?: 'compute' | null;
}

export type DeepLinkRoute = `/code/${string}` | `/post/${string}` | `/task/${string}` | `/thread/${string}` | `/channel/${string}` | '/compute';

export function routeForData(data: DeepLink | undefined | null): DeepLinkRoute | null {
  if (!data) return null;
  if (data.codeSessionId) return `/code/${data.codeSessionId}`;
  // ahead of the task and thread rungs on purpose: a review reminder names the room the post lives
  // in AND the item, and landing on the room would make you hunt for the thing you were warned about
  if (data.contentItemId) return `/post/${data.contentItemId}`;
  if (data.taskId) return `/task/${data.taskId}`;
  if (data.threadId) return `/thread/${data.threadId}`;
  if (data.channelId) return `/channel/${data.channelId}`;
  if (data.route === 'compute' || data.machineId) return '/compute';
  return null;
}
