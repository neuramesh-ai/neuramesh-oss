// A send the server refuses is dropped so the ordered queue keeps moving, which is right. The row
// it names is a local optimistic insert, so it then disappears in front of the person who typed it
// — which is what George saw. This is the half that was missing: the drop is remembered.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDroppedUpload, getDroppedUpload, noteDroppedUpload, onDroppedUpload } from '../src/upload-trouble';

beforeEach(() => clearDroppedUpload());

describe('a dropped upload', () => {
  it('starts with nothing to report', () => {
    expect(getDroppedUpload()).toBeNull();
  });

  it('keeps the server reason and the words that were lost', () => {
    noteDroppedUpload('not your workspace', 'hey rex, what moved?');
    expect(getDroppedUpload()?.reason).toBe('not your workspace');
    expect(getDroppedUpload()?.body).toBe('hey rex, what moved?');
  });

  it('tells a listener on both the drop and the dismissal', () => {
    const seen = vi.fn();
    const off = onDroppedUpload(seen);
    noteDroppedUpload('nope', 'a');
    clearDroppedUpload();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[0]?.[0]?.reason).toBe('nope');
    expect(seen.mock.calls[1]?.[0]).toBeNull();
    off();
  });

  it('does not wake listeners for a dismissal that dismisses nothing', () => {
    const seen = vi.fn();
    const off = onDroppedUpload(seen);
    clearDroppedUpload();
    expect(seen).not.toHaveBeenCalled();
    off();
  });

  it('keeps only the newest, because the banner shows one', () => {
    noteDroppedUpload('first', 'a');
    noteDroppedUpload('second', 'b');
    expect(getDroppedUpload()?.reason).toBe('second');
  });
});
