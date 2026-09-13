// Pure SKILL.md parser shared by the bundled-seed generator and the host's
// Curator importer. A skill repo is a tree of `**/SKILL.md` files with YAML
// frontmatter (`name`, `description`) over a markdown body. Both supported
// layouts — gstack (top-level `<name>/SKILL.md`) and addyosmani
// (`skills/<name>/SKILL.md`) — fall out of one glob. Deterministic, no network.

export interface ParsedSkill {
  name: string;
  description: string;
  body: string;
}

export function slugifySkillName(raw: string): string {
  // strip a leading `plugin:` / `pack:` namespace, then kebab-case
  const base = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  return (
    base
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'skill'
  );
}

// Parse one SKILL.md. `relPath` is used to derive a name when frontmatter omits
// it (…/<name>/SKILL.md). Returns null for an empty body.
export function parseSkillFile(relPath: string, content: string): ParsedSkill | null {
  let name = '';
  let description = '';
  let body = content.trim();
  const fm = content.match(/^﻿?\s*---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fm) {
    const front = fm[1] ?? '';
    body = (fm[2] ?? '').trim();
    const nameM = front.match(/^\s*name:\s*["']?([^"'\n]+?)["']?\s*$/im);
    const descM = front.match(/^\s*description:\s*["']?([^\n]+?)["']?\s*$/im);
    if (nameM) name = nameM[1]!.trim();
    if (descM) description = descM[1]!.trim();
  }
  if (!name) {
    const parts = relPath.split('/').filter((p) => p && p !== 'SKILL.md');
    name = parts[parts.length - 1] ?? 'skill';
  }
  name = slugifySkillName(name);
  if (!description) {
    const firstPara = body
      .split(/\n\s*\n/)
      .map((s) => s.replace(/^#+\s*/, '').trim())
      .find((s) => s.length > 0);
    description = (firstPara ?? name).replace(/\s+/g, ' ');
  }
  description = description.replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!body.trim()) return null;
  return { name, description, body };
}

// Parse a set of SKILL.md files into a deduped, name-sorted skill list.
export function parseSkillFiles(files: Array<{ path: string; content: string }>): ParsedSkill[] {
  const seen = new Set<string>();
  const out: ParsedSkill[] = [];
  for (const f of files) {
    const sk = parseSkillFile(f.path, f.content);
    if (!sk || seen.has(sk.name)) continue;
    seen.add(sk.name);
    out.push(sk);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
