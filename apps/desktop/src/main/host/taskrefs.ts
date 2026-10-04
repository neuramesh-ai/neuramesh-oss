// THE TASKS A BRIEF NAMES, IN THE BRIEF (docs/design/repo-connect-2026-10). A deep-work leg sees ONLY
// its brief, and no leg holds a board read by design (harness.ts: workers never read the board). So a
// brief that says "what does #1046 need" sent a leg off with a number and no task: it answered "I
// cannot access backlog item #1046 here. Please paste its title". The tool now resolves every #N the
// brief names from the replica and appends the task itself, so the leg reads what rex read.
type ReplicaDb = { getAll<T>(sql: string, params?: unknown[]): Promise<T[]> };

const REF = /(?:^|[^\w&/])#(\d{1,6})\b/g;
const MAX_REFS = 6;
const DESC_CAP = 1_200;

/** the distinct task numbers a text names (#1046), in order, at most six */
export function taskNumbersIn(text: string): number[] {
  const seen: number[] = [];
  for (const m of text.matchAll(REF)) {
    const n = Number(m[1]);
    if (!seen.includes(n)) seen.push(n);
    if (seen.length >= MAX_REFS) break;
  }
  return seen;
}

/** the referenced tasks of this workspace as one block for a brief, or '' when the text names none */
export async function referencedTasks(db: ReplicaDb, workspace: string, text: string): Promise<string> {
  const nums = taskNumbersIn(text);
  if (!nums.length) return '';
  const found: string[] = [];
  for (const n of nums) {
    const [t] = await db.getAll<{ number: number; title: string; state: string; description: string | null }>(
      `select t.number, t.title, t.state, t.description from tasks t join channels c on c.id = t.channel_id where c.workspace_id = ? and t.number = ? limit 1`,
      [workspace, n],
    ).catch(() => []);
    if (!t) continue;
    const desc = (t.description ?? '').trim();
    found.push(`#${t.number} · ${t.title} · ${t.state}${desc ? `\n${desc.length > DESC_CAP ? `${desc.slice(0, DESC_CAP)}…` : desc}` : ''}`);
  }
  return found.length ? `The tasks this brief names, from the board:\n\n${found.join('\n\n')}` : '';
}
