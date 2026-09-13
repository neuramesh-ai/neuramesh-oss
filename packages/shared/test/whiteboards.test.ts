// Whiteboards (docs/38): the shared contract — the source envelope, the scene parse, and the
// share marker a thread message carries. The marker's parser is tested the way docdrop's is:
// a parser that silently stops matching turns every board card back into a wall of text.
import { describe, expect, it } from 'vitest';
import {
  parseWhiteboardRef,
  parseWhiteboardScene,
  parseWhiteboardSource,
  whiteboardShareBody,
  whiteboardSource,
} from '../src/whiteboards';

describe('the source envelope', () => {
  it('round-trips both dialects and refuses everything else', () => {
    expect(parseWhiteboardSource(whiteboardSource('mermaid', 'flowchart LR; a-->b'))).toEqual({ kind: 'mermaid', value: 'flowchart LR; a-->b' });
    expect(parseWhiteboardSource(whiteboardSource('elements', '[{"type":"rectangle"}]'))).toEqual({ kind: 'elements', value: '[{"type":"rectangle"}]' });
    expect(parseWhiteboardSource(null)).toBeNull();
    expect(parseWhiteboardSource('')).toBeNull();
    expect(parseWhiteboardSource('not json')).toBeNull();
    expect(parseWhiteboardSource('{"kind":"png","value":"x"}')).toBeNull();
    expect(parseWhiteboardSource('{"kind":"mermaid","value":""}')).toBeNull();
  });
});

describe('the scene parse', () => {
  it('accepts elements + optional appState, refuses shapes that are not a scene', () => {
    expect(parseWhiteboardScene('{"elements":[]}')).toEqual({ elements: [], appState: undefined });
    expect(parseWhiteboardScene('{"elements":[{"type":"rectangle"}],"appState":{"viewBackgroundColor":"#fff"}}')?.appState).toEqual({ viewBackgroundColor: '#fff' });
    expect(parseWhiteboardScene('{"appState":{}}')).toBeNull();
    expect(parseWhiteboardScene('{"elements":"nope"}')).toBeNull();
    expect(parseWhiteboardScene('[]')).toBeNull();
    expect(parseWhiteboardScene('')).toBeNull();
    expect(parseWhiteboardScene(null)).toBeNull();
  });
});

describe('the share marker', () => {
  const id = '0d9f5c4a-3b2e-4f6d-8a1c-9e7b6d5c4f3a';

  it('the body leads with a readable label line and hides the marker', () => {
    const body = whiteboardShareBody('offline sync map', id);
    expect(body).toBe(`⊞ **offline sync map** — whiteboard\n‹wb:${id}›`);
    const ref = parseWhiteboardRef(body);
    expect(ref?.id).toBe(id);
    expect(ref?.body).toBe('⊞ **offline sync map** — whiteboard'); // the fallback text survives the strip
    expect(ref?.prose).toBe(''); // …but a surface WITH the card renders no duplicate label
  });

  it('a sharer note rides above the label and survives both strips', () => {
    const body = whiteboardShareBody('sync map', id, 'here is the race, drawn');
    const ref = parseWhiteboardRef(body);
    expect(ref?.id).toBe(id);
    expect(ref?.body).toContain('here is the race, drawn');
    expect(ref?.body).toContain('⊞ **sync map** — whiteboard');
    expect(ref?.body).not.toContain('‹wb:');
    expect(ref?.prose).toBe('here is the race, drawn'); // the note stays, the label goes with the card
  });

  it('uppercase ids normalize, prose without a marker is null, and a markerless ⊞ line is left alone', () => {
    expect(parseWhiteboardRef(`x\n‹wb:${id.toUpperCase()}›`)?.id).toBe(id);
    expect(parseWhiteboardRef('a plain message about whiteboards')).toBeNull();
    expect(parseWhiteboardRef(null)).toBeNull();
    expect(parseWhiteboardRef('⊞ **hand-typed** — whiteboard')).toBeNull();
  });
});
