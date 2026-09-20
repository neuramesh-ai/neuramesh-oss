// THE PRODUCT IMAGE, MADE (video-rung plan §9, George 2026-09-20: "the agent should be able to
// search the project files for actual product images or generate the product images using an
// image model for the image it needs"). A video beat that shows the product cuts to a real image
// (`SHOW: <name>` in the script); when the shelf holds none, this makes one on the room's image
// key and shelves it under the name the script will use, so the same turn can draft. The search
// is `list_library` (scope project shows every room's images); this is the fallback, and it says
// so: a made picture of an APP is an invented interface, so for an app the tool asks for a real
// screenshot first and makes one only on the human's word.
import { shelfDataUrl } from '../imagegen';
import type { OrchTool, ToolCtx } from './orchtools';
import type { ChatToolCtx } from './chattools';

const DESC = 'Make a product image for a video beat that has none on the shelf, and put it on this room\'s shelf under `name`, so the script can say `SHOW: <name>` and the film cuts to it. Search first: list_library (scope project) lists the images the team already has, and a real screenshot always beats a made one, and a portrait image fills the film\'s frame best (a wide one shows as a close-up). For an APP or a screen, do not invent an interface: ask the human for a screenshot unless they said to make one. Use it for a product you can picture (a device, a bottle, a box, a scene with the product) or when the human asked.';
const shape = (z: ToolCtx['z']) => ({
  name: z.string().min(1).max(120).describe('the file name the script will use in its SHOW line, e.g. bottle-on-desk.jpg'),
  brief: z.string().min(8).max(1200).describe('art direction for the product image: the product, the angle, the setting, the light, on-brand'),
});

/** the one implementation: make, shrink to the shelf's size, shelve, answer with the name */
export async function makeProductImage(t: Pick<ChatToolCtx, 'agent' | 'ch' | 'post' | 'log' | 'generateShareImage'>, actor: { kind: string; id: string; role?: string }, input: { name: string; brief: string }): Promise<string> {
  const name = /\.(jpe?g|png|webp)$/i.test(input.name.trim()) ? input.name.trim() : `${input.name.trim()}.jpg`;
  const g = await t.generateShareImage(t.agent, t.ch, input.brief);
  if (!g.bytes) return `the product image was not made: ${g.error ?? 'the image came back empty'}. Say so plainly; do not claim an image exists.`;
  const dataUrl = await shelfDataUrl(g.bytes);
  if (!dataUrl) return 'the product image was made but could not be shrunk for the shelf. Say so plainly.';
  const res = await t.post('/v1/commands', actor, { type: 'artifact.create', channel: t.ch.id, kind: 'file', name, mime: 'image/jpeg', inlineContent: dataUrl }).catch(() => null);
  if (!res?.ok) return `the product image was made but did not reach the shelf (${res?.status ?? 'no answer'}). Say so plainly.`;
  t.log({ kind: 'tool', phase: 'call', summary: `make_product_image ${name}` });
  return `${name} is on this room's shelf. Write \`SHOW: ${name}\` on the beat that shows the product; the film cuts to this image there. A made picture is a stand-in: say so to the human, who can replace it with a real one in Files.`;
}

/** the conversation registry's tool (host/chattools.ts spreads it) */
export function productChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'post' | 'log' | 'generateShareImage'>) {
  return [t.tool('make_product_image', DESC, shape(t.z), async (i) => t.text(await makeProductImage(t, { kind: 'agent', id: t.agent.id, ...(t.agent.role ? { role: t.agent.role } : {}) }, i as { name: string; brief: string })))];
}

/** the orchestrator registry's tool (host/tools-content.ts spreads it) */
export function productOrchTools(tc: Pick<ToolCtx, 'z' | 'agent' | 'ch' | 'post' | 'actor' | 'log' | 'generateShareImage'>): OrchTool[] {
  const log = tc.log ?? (() => {});
  return [{ name: 'make_product_image', description: DESC, schema: shape(tc.z), run: (input: { name: string; brief: string }) => makeProductImage({ ...tc, log }, tc.actor, input) }];
}
