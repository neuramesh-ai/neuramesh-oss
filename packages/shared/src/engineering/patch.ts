/** Every source and destination a Cline patch can write. Shared by the renderer, policy gate, and
 * executor so a newly supported patch operation cannot bypass or disappear from one boundary. */
export function engineeringPatchPaths(patch: string): string[] {
  const paths: string[] = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  for (const match of patch.matchAll(pattern)) paths.push((match[1] ?? match[2] ?? '').trim());
  return paths.filter(Boolean);
}
