// The version `/.well-known/nm-config` reports (review F7: the desktop compares it with its own
// and shows the Update state on a mismatch). The release version lives in the ROOT package.json —
// the one `vX.Y.Z` tags and the desktop's app.getVersion() carry — not in this package's, which
// has said 0.1.0 since the repo began. NM_VERSION wins when set (a build that stamps itself); the
// file walk covers `tsx src/server.ts` (src/ → repo root) and the image's bundle (dist/ → /app).
import { readFileSync } from 'node:fs';

let cached: string | null = null;

export function nmVersion(): string {
  if (cached) return cached;
  const fromEnv = process.env['NM_VERSION'];
  if (fromEnv) return (cached = fromEnv);
  for (const rel of ['../package.json', '../../package.json', '../../../package.json']) {
    try {
      const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as { name?: string; version?: string };
      if (pkg.name === 'neuramesh' && pkg.version) return (cached = pkg.version);
    } catch {
      // not this level — keep walking up
    }
  }
  return (cached = '0.0.0');
}
