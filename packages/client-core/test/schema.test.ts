import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TABLE_COLUMNS } from '../src/schema';

// Drift tripwire: client-core copies the desktop schema (they can't share the file
// — different PowerSync SDKs). This reads the desktop source as text and asserts
// the two are byte-for-column identical, so adding a column to one without the
// other fails CI. Delete this once the desktop adopts client-core's schema.
//
// The desktop's tables moved out of sync.ts into main/sync/schema/* (grouped by domain,
// the same grouping the renderer uses for its row types), so this reads the DIRECTORY and
// the composing schema.ts. Reading one file was an assumption about layout, not about the
// contract this test actually guards.
const schemaDir = fileURLToPath(new URL('../../../apps/desktop/src/main/sync/schema', import.meta.url));
const src = readdirSync(schemaDir)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => readFileSync(join(schemaDir, f), 'utf8'))
  .join('\n');
const composed = readFileSync(fileURLToPath(new URL('../../../apps/desktop/src/main/sync/schema.ts', import.meta.url)), 'utf8');

function desktopTables(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const m of src.matchAll(/(?:export )?const (\w+) = new Table\(\{([\s\S]*?)\}\)/g)) {
    const cols: Record<string, string> = {};
    for (const cm of m[2]!.matchAll(/(\w+):\s*column\.(text|integer)/g)) cols[cm[1]!] = cm[2]!;
    out[m[1]!] = cols;
  }
  return out;
}

describe('client-core schema parity with the desktop AppSchema', () => {
  it('mirrors every desktop table + column exactly', () => {
    const tables = desktopTables();
    // the positive control: a parser that finds nothing would satisfy any expectation
    expect(Object.keys(tables).length).toBeGreaterThan(20);
    expect(tables).toEqual(TABLE_COLUMNS);
  });

  it('the desktop Schema() registers exactly the tables client-core mirrors', () => {
    const inner = /new Schema\(\{([^}]*)\}\)/.exec(composed)?.[1] ?? '';
    const tables = inner.split(',').map((s) => s.trim()).filter(Boolean);
    expect(new Set(tables)).toEqual(new Set(Object.keys(TABLE_COLUMNS)));
  });
});
