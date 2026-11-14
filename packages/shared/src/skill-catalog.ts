/** Packs used to be seeded per room. Show and load one current copy across the workspace. */
export function uniqueWorkspaceSkills<T extends { id: string; name: string; pack_name?: string | null; version?: number; updated_at?: string }>(skills: readonly T[]): T[] {
  const seen = new Set<string>();
  return [...skills].sort((a, b) => (b.version ?? 0) - (a.version ?? 0) || (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.id.localeCompare(b.id))
    .filter(skill => {
      const key = JSON.stringify([skill.name, skill.pack_name ?? null]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
