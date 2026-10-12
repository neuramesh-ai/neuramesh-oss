// AN APP SCREENSHOT FROM THE CODE (George, 2026-10-06: "when we need an actual screenshot, it should be
// an actual screenshot of the app from our codebase or workspace files instead of a social platform or
// random screenshot"). A video beat that puts the app's screen on camera cuts to a real screenshot
// (`SHOW: <name>` in the script). The ones a person put in Files are on the shelf already
// (list_library, scope project); this tool takes one from the project's repository. The agent names
// the file and the platform does the rest (POST /v1/repo/shelve): it reads the file through the
// GitHub App, makes the shelf copy and marks it as the repository's, the one mark that lets a film
// show an image an agent asked for. The agent never handles the bytes. It replaced make_product_image,
// whose drawn picture of an app was an invented interface.
import type { OrchTool, ToolCtx } from './orchtools';
import type { ChatToolCtx } from './chattools';

const DESC = 'Take a real screenshot of the app from the project\'s repository and put it on this room\'s shelf, so a video beat can say `SHOW: <name>` and the film cuts to it. Find the image first with list_repo_files (screenshots, store or docs images: .png, .jpg, .webp). A film shows only a screenshot from the repository or an image a person put in Files: never a web capture or a drawn picture.';
const shape = (z: ToolCtx['z']) => ({
  path: z.string().min(1).max(400).describe('the image file\'s path in the repository, as list_repo_files names it, e.g. docs/screens/home.png'),
  name: z.string().min(1).max(120).optional().describe('the shelf name the script will use in its SHOW line; the file\'s own name when left out'),
});

/** the one implementation: ask the platform to shelve the file, answer with the name the script uses */
export async function shelveRepoScreenshot(t: Pick<ChatToolCtx, 'ch' | 'post' | 'log'>, actor: { kind: string; id: string; role?: string }, input: { path: string; name?: string }): Promise<string> {
  const res = await t.post(`/v1/repo/shelve?channel=${encodeURIComponent(t.ch.id)}`, actor, { path: input.path, ...(input.name ? { name: input.name } : {}) }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { name?: string; path?: string; error?: string } | null;
  if (!res?.ok || !body?.name) return `The screenshot did not reach the shelf: ${body?.error ?? `the server answered ${res?.status ?? 'nothing'}`}. Say so plainly, and do not claim an image exists.`;
  t.log({ kind: 'tool', phase: 'call', summary: `shelve_repo_screenshot ${input.path}` });
  return `${body.name} is on this room's shelf, the repository's own ${body.path ?? input.path}. Write \`SHOW: ${body.name}\` on the beat that puts the app's screen on camera; the film cuts to this screenshot there.`;
}

/** the conversation registry's tool (host/chattools.ts spreads it) */
export function productChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'post' | 'log'>) {
  return [t.tool('shelve_repo_screenshot', DESC, shape(t.z), async (i) => t.text(await shelveRepoScreenshot(t, { kind: 'agent', id: t.agent.id, ...(t.agent.role ? { role: t.agent.role } : {}) }, i as { path: string; name?: string })))];
}

/** the orchestrator registry's tool (host/tools-content.ts spreads it) */
export function productOrchTools(tc: Pick<ToolCtx, 'z' | 'agent' | 'ch' | 'post' | 'actor' | 'log'>): OrchTool[] {
  const log = tc.log ?? (() => {});
  return [{ name: 'shelve_repo_screenshot', description: DESC, schema: shape(tc.z), run: (input: { path: string; name?: string }) => shelveRepoScreenshot({ ...tc, log }, tc.actor, input) }];
}
