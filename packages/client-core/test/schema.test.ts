import { describe, expect, it } from 'vitest';
import { AppSchema, TABLE_COLUMNS, TABLES } from '../src/schema';

// the replica schema is ONE source since phase 2.1 of the decoupling plan: the desktop, the cloud
// machines, the web client and the phone all open src/schema.ts. these guard the composition. the
// contract corpus (docs/46) guards what an installed desktop still needs from it.
describe('the shared replica schema', () => {
  it('registers every table under its own name', () => {
    // the positive control: a composition that found nothing would satisfy any set equality
    expect(Object.keys(TABLES).length).toBeGreaterThan(20);
    expect(new Set(AppSchema.tables.map((t) => t.name))).toEqual(new Set(Object.keys(TABLES)));
  });

  it('reads each column type from the tables themselves', () => {
    expect(TABLE_COLUMNS['messages']?.['body']).toBe('text');
    expect(TABLE_COLUMNS['tasks']?.['number']).toBe('integer');
    for (const cols of Object.values(TABLE_COLUMNS)) {
      for (const type of Object.values(cols)) expect(['text', 'integer']).toContain(type);
    }
  });

  it('keeps the replica indexes for every client (docs/18)', () => {
    const indexed = AppSchema.tables.filter((t) => t.indexes.length > 0).map((t) => t.name);
    expect(indexed).toContain('messages');
    expect(indexed).toContain('channels');
  });
});
