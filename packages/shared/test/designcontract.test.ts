// The designer's turn is composed from defaults/agents/designer.yaml. buildDesignPrompt owns the
// assembly; these guard the SEAM between them, which is where extraction goes wrong.
//
// A real one, caught by a differential run against the pre-extraction implementation: the YAML
// block kept the leading newline the code also added, so every reworked design turn shipped a
// doubled blank line. Byte-identity nets catch that; key-phrase assertions alone would not, which
// is why the newline shape is asserted here explicitly.
import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { buildDesignPrompt, designSystemPrompt } from '../src/prompts';

const blocks = (load(readFileSync(join(import.meta.dirname, '../../../defaults/agents/designer.yaml'), 'utf8')) as { prompt: Record<string, string> }).prompt;
const task = { number: 1051, title: 'Redesign the task panel header', description: 'The header is doing three jobs at once.', requirements: JSON.stringify(['one row of toks', 'both themes']) };

test('the contract supplies every block the design turn reads', () => {
  for (const k of ['system', 'turn', 'checklist', 'channel', 'study.prior', 'study.repo', 'study.none', 'feedback']) {
    expect((blocks[k] ?? '').trim().length, `designer.yaml is missing prompt.${k}`).toBeGreaterThan(0);
  }
});

test('each study path lands, and none leaves an unresolved placeholder', () => {
  const repo = buildDesignPrompt(blocks, task, { repoBacked: true });
  const scratch = buildDesignPrompt(blocks, task, { repoBacked: false });
  const rework = buildDesignPrompt(blocks, task, { priorMockups: ['01-header.html'], priorRound: 2 });
  expect(repo).toMatch(/STUDY BEFORE YOU DRAW/);
  expect(scratch).toMatch(/No repository is bound to this task/);
  expect(rework).toMatch(/YOU ALREADY STUDIED THIS — round 2 is on disk/);
  expect(rework).toMatch(/\(01-header\.html\)/);
  // composePrompt leaves an unknown ${name} INTACT so a typo is visible — so a surviving one here
  // means a variable the contract asks for that the assembly never passes
  for (const [label, p] of [['repo', repo], ['scratch', scratch], ['rework', rework]] as const) {
    expect(/\$\{[A-Za-z_]/.test(p), `${label} turn has an unresolved placeholder: ${p.match(/\$\{[A-Za-z_][\w.]*\}/)?.[0]}`).toBe(false);
  }
  expect(designSystemPrompt(blocks, 'iris', true)).toMatch(/^You are iris, .* from a read-only repository checkout\./);
  expect(designSystemPrompt(blocks, 'iris', false)).toMatch(/in a scratch workspace\./);
});

test('optional blocks keep their spacing — no doubled blank lines, none missing', () => {
  const full = buildDesignPrompt(blocks, task, { repoBacked: true, feedback: 'the second row is too tight', channelBlock: 'the room settled on one facts line' });
  expect(!/\n\n\n/.test(full), 'a block doubled its surrounding newline').toBe(true);
  expect(full).toMatch(/\n\nA human reviewed your previous mockups/);
  expect(full).toMatch(/\n\nChannel context \(summary\):\nthe room settled on one facts line\n/);
  // and with every optional block absent, the turn still reads as one document
  const bare = buildDesignPrompt(blocks, { number: 1, title: 'x' }, { repoBacked: true });
  expect(!/\n\n\n/.test(bare), 'the empty case collapsed into a gap').toBe(true);
  expect(bare).toMatch(/^Design board task #1: x\n\nSTUDY BEFORE YOU DRAW/);
});
