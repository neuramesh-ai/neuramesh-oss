import type { DrawOutcome } from './drawdraft';

/** Copy revisions can succeed while their images fail. Keep those outcomes separate. */
export async function redrawDraftImages(letters: string[], drafts: ReadonlyMap<string, { id: string }>, generate: (id: string) => Promise<DrawOutcome>) {
  const redrew: string[] = [], failed: string[] = [];
  for (const letter of letters) {
    const draft = drafts.get(letter);
    if (!draft) { failed.push(`${letter}: Draft is no longer available.`); continue; }
    const result = await generate(draft.id).catch((error): DrawOutcome => ({ ok: false, error: error instanceof Error ? error.message : 'Image generation failed.' }));
    if (result.ok) redrew.push(letter);
    else failed.push(`${letter}: ${result.error}`);
  }
  return { redrew, failed };
}
