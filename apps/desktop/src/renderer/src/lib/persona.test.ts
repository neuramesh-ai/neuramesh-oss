import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbAvatar, thumbOutline } from './persona';

const svgOf = (uri: string) => decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
const geometry = (svg: string) => [...svg.matchAll(/\b(?:d|transform)="([^"]*)"/g)].map((match) => match[0]);

test('paper outlines retain each original agent face and remove the solid color surfaces', () => {
  const names = ['atlas', 'bosun', 'curator', 'iris', 'patch', 'scout', 'Custom agent'];
  const outlines = names.map((name) => {
    const original = svgOf(thumbAvatar(name));
    const outline = svgOf(thumbOutline(name));
    assert.deepEqual(geometry(outline), geometry(original), `${name}: original face geometry`);
    assert.equal((outline.match(/<rect\b/g) ?? []).length, 1, `${name}: only the viewbox mask remains`);
    assert.match(outline, /fill="none" stroke="#000" stroke-width="4.5"/);
    assert.equal((outline.match(/fill="#000"/g) ?? []).length, 2, `${name}: eyes and mouth remain solid ink`);
    assert.equal(thumbOutline(` ${name.toUpperCase()} `), thumbOutline(name), 'the original name normalization applies');
    assert.equal(svgOf(thumbAvatar(name)), original, 'the elevated image stays intact');
    return outline;
  });
  assert.equal(new Set(outlines).size, names.length, 'each agent keeps a distinct face');
});
