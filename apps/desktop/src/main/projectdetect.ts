// Folder → project-metadata detection for the New project flow: a few local file
// reads (package.json, README, .git/config, top-level dirs), no network, and the
// path never leaves the machine. Every probe is best-effort — a folder that
// defeats detection still yields safe fallbacks (basename + default rooms), so
// the modal can always prefill instantly. Pure helpers are exported for tests.
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

export interface ProjectDetect {
  name: string;
  slug: string;
  description: string;
  remoteUrl: string | null; // origin URL as written in .git/config
  remoteLabel: string | null; // normalized host/owner/repo for display
  rooms: string[]; // suggested starter rooms, DEFAULT_CHANNELS order
}

// mirrors the control-api slugify — the server still resolves collisions (-2, -3…)
export const slugifyName = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// `[remote "origin"] url = …` → display label. Handles scp-like (git@host:o/r.git),
// ssh://, and http(s):// forms; anything unrecognized keeps the raw URL as its label.
export function parseOriginRemote(gitConfig: string): { url: string; label: string } | null {
  const sect = /\[remote\s+"origin"\]([^[]*)/.exec(gitConfig);
  const url = sect?.[1] ? /(?:^|\n)\s*url\s*=\s*(\S+)/.exec(sect[1])?.[1] ?? null : null;
  if (!url) return null;
  const m =
    /^(?:ssh:\/\/)?(?:[\w.-]+@)?([\w.-]+)[:/]+(.+?)(?:\.git)?\/?$/.exec(url.replace(/^https?:\/\//, '')) ?? null;
  return { url, label: m ? `${m[1]}/${m[2]}` : url };
}

// first real prose paragraph of a README — headings, badge/image/link-only lines and
// HTML skipped, inline markdown stripped, capped at a word boundary.
export function descriptionFromReadme(md: string, cap = 160): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const stripped = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images/badges
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
      .replace(/<[^>]+>/g, '') // html
      .replace(/[`*_]+/g, '')
      .trim();
    const skip = !stripped || /^#/.test(raw.trim()) || /^[->|]/.test(raw.trim()) || /^[=-]{3,}$/.test(stripped);
    if (skip) { if (out.length) break; continue; } // blank/again-skippable line ends a started paragraph
    out.push(stripped);
  }
  const text = out.join(' ').replace(/\s+/g, ' ').trim();
  if (text.length <= cap) return text;
  const cut = text.slice(0, cap);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), cap - 20))}…`;
}

// conservative room suggestions from top-level dirs — #general + #dev always; the
// extra rooms only on unambiguous dir names (never guess from app code layout).
export function suggestRooms(dirNames: string[]): string[] {
  const dirs = new Set(dirNames.map((d) => d.toLowerCase()));
  const rooms = ['general', 'dev'];
  if (['research', 'notebooks', 'papers'].some((d) => dirs.has(d))) rooms.push('research');
  if (['marketing', 'site', 'www'].some((d) => dirs.has(d))) rooms.push('marketing');
  return rooms;
}

export async function detectProjectMeta(root: string): Promise<ProjectDetect> {
  const name = basename(root.replace(/[/\\]+$/, '')) || 'project';
  const read = (rel: string) => readFile(join(root, rel), 'utf8').catch(() => null);

  let description = '';
  const pkgRaw = await read('package.json');
  if (pkgRaw) {
    try {
      const desc = (JSON.parse(pkgRaw) as { description?: unknown }).description;
      if (typeof desc === 'string') description = desc.trim().slice(0, 200);
    } catch { /* malformed package.json — fall through to README */ }
  }
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  if (!description) {
    const readme = entries.find((e) => e.isFile() && /^readme(\.(md|markdown|txt))?$/i.test(e.name));
    const md = readme ? await read(readme.name) : null;
    if (md) description = descriptionFromReadme(md);
  }

  const gitConfig = await read(join('.git', 'config'));
  const remote = gitConfig ? parseOriginRemote(gitConfig) : null;

  return {
    name,
    slug: slugifyName(name),
    description,
    remoteUrl: remote?.url ?? null,
    remoteLabel: remote?.label ?? null,
    rooms: suggestRooms(entries.filter((e) => e.isDirectory()).map((e) => e.name)),
  };
}
