import { parseSpecStreamLine, type Spec, type SpecStreamLine } from '@json-render/core';

export type SpecPatch = SpecStreamLine;

const FENCE_OPEN = /^\s*```spec\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;

/** Splits a streamed reply into chat text and spec patches. Text before and after the ```spec fence is chat text.
 * A partial line is held back only while it could still become a fence. */
export function createSpecStreamParser(callbacks: { onText: (delta: string) => void; onPatch: (patch: SpecPatch) => void }) {
  let line = '', inFence = false, atLineStart = true, emittedHead = 0;
  function finishLine(full: string) {
    if (!inFence && FENCE_OPEN.test(full)) { inFence = true; return; }
    if (inFence) {
      if (FENCE_CLOSE.test(full)) { inFence = false; return; }
      const patch = parseSpecStreamLine(full);
      if (patch) callbacks.onPatch(patch);
      return;
    }
    if (full.length > emittedHead) callbacks.onText(full.slice(emittedHead));
    callbacks.onText('\n');
  }
  function push(delta: string) {
    for (const char of delta) {
      if (char === '\n') { finishLine(line); line = ''; atLineStart = true; emittedHead = 0; continue; }
      line += char;
      if (inFence || !atLineStart) continue;
      // Outside a fence, stream text at once unless the line can still turn into "```spec".
      const trimmed = line.trimStart();
      if (!'```spec'.startsWith(trimmed.slice(0, 7)) || (trimmed.length > 7 && !FENCE_OPEN.test(line))) {
        atLineStart = false;
        callbacks.onText(line.slice(emittedHead)); emittedHead = line.length;
      }
    }
    if (!inFence && !atLineStart && line.length > emittedHead) { callbacks.onText(line.slice(emittedHead)); emittedHead = line.length; }
  }
  function end() {
    if (line) { const full = line; line = ''; if (!inFence && FENCE_OPEN.test(full)) return; if (inFence) { const patch = parseSpecStreamLine(full); if (patch) callbacks.onPatch(patch); } else if (full.length > emittedHead) callbacks.onText(full.slice(emittedHead)); }
  }
  return { push, end };
}

export function emptySpec(): Spec { return { root: '', elements: {} } as Spec; }
