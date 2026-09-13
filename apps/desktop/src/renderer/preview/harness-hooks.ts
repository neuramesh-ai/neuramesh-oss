// THE STATES A SHOT CANNOT REACH BY DRIVING THE UI.
//
// Some states exist only in TIME — an agent that speaks after first paint, a message nobody has
// answered for three minutes. A capture cannot wait for them and cannot fake them by clicking, so
// the harness hands them over as window functions the shot spec calls in its `js` step.
//
// They live here rather than beside the rows they mutate because mock-fixtures.ts is data, and its
// standing size exemption says so in as many words: "Revisit if behaviour creeps in." This is the
// behaviour, so it crept out instead.
//
//   window.__nmAgentSays(taskId, agentId, body)      — an agent posts into a task thread
//   window.__nmHumanSays(taskId, body, agoMs?)       — you replied, and nothing has answered
//   window.__nmHumanSaysInConvo(threadId, body, ms?) — the same, in a conversation
//
// `agoMs` ages the message, which is what makes the WAIT DEADLINE reachable (docs/26 §5): a state
// that by definition only exists minutes after a send.
import { baseThreadRows, convoMsgs, pingConvo, taskThreadExtra, taskThreadWatchers } from './mock-fixtures';

const push = (rows: any[], key: string, row: Record<string, unknown>) => {
  rows.push({ id: `${key}-${rows.length + 1}`, created_at: new Date().toISOString(), ...row });
};

/** an agent posts into a task thread AFTER first paint */
export const agentSays = (taskId: string, agentId: string, body: string) => {
  const rows = (taskThreadExtra[taskId] ??= []);
  push(rows, `late-${taskId}`, { author_kind: 'agent', author_id: agentId, body });
  for (const w of taskThreadWatchers) if (w.id === taskId) w.cb([...baseThreadRows(w.id), ...rows]);
};

/** …and its twin: the HUMAN replied and nothing has answered yet. The mock's own sendThread opens
 *  a token stream in the same tick, which is a local daemon's luxury and exactly what a browser
 *  does not have — so without this the wait ghost's own states are unreachable for review. */
export const humanSays = (taskId: string, body: string, agoMs = 0) => {
  const rows = (taskThreadExtra[taskId] ??= []);
  push(rows, `hum-${taskId}`, { author_kind: 'human', author_id: 'u-george', body, created_at: new Date(Date.now() - agoMs).toISOString() });
  for (const w of taskThreadWatchers) if (w.id === taskId) w.cb([...baseThreadRows(w.id), ...rows]);
};

/** the conversation twin. It SORTS, because the real watchConvo is `order by created_at asc`
 *  (webnm-convo.ts) and the wait ladder reads the last row: appended raw, an aged message would be
 *  newest to the rule and oldest on screen at the same time. */
export const humanSaysInConvo = (threadId: string, body: string, agoMs = 0) => {
  const rows = (convoMsgs[threadId] ??= []);
  push(rows, `hum-${threadId}`, { author_kind: 'human', author_id: 'u-george', body, created_at: new Date(Date.now() - agoMs).toISOString() });
  rows.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  pingConvo(threadId);
};

if (typeof window !== 'undefined') Object.assign(window, { __nmAgentSays: agentSays, __nmHumanSays: humanSays, __nmHumanSaysInConvo: humanSaysInConvo });
