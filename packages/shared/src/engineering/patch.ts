/** Every source and destination a Cline patch can write. Shared by the renderer, policy gate, and
 * executor so a newly supported patch operation cannot bypass or disappear from one boundary. */
export function engineeringPatchPaths(patch: string): string[] {
  const paths: string[] = [];
  const pattern = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;
  for (const match of patch.matchAll(pattern)) paths.push((match[1] ?? match[2] ?? '').trim());
  return [...new Set(paths.filter(Boolean))];
}

export interface EngineeringPatchOperation { kind: 'Add' | 'Update' | 'Delete'; path: string; previousPath?: string; lines: string[] }

/** Parse file boundaries only. The machine uses the runtime's parser to apply update hunks. */
export function parseEngineeringPatch(patch: string): EngineeringPatchOperation[] {
  const operations: EngineeringPatchOperation[] = [];
  let current: EngineeringPatchOperation | undefined;
  for (const line of patch.replace(/\r\n/g, '\n').split('\n')) {
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      current = { kind: header[1] as EngineeringPatchOperation['kind'], path: header[2]!.trim(), lines: [] };
      operations.push(current);
    } else if (line === '*** End Patch') break;
    else if (current && line.startsWith('*** Move to: ')) { current.previousPath = current.path; current.path = line.slice(13).trim(); }
    else if (current) current.lines.push(line);
  }
  return operations;
}
