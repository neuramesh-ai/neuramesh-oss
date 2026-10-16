import assert from 'node:assert/strict';
import test from 'node:test';
import { artifactContent } from './artifact-content';

test('old generic media records retain bytes and gain native MIME types', async () => {
  for (const [name, kind, mime] of [['film.mp4', 'video', 'video/mp4'], ['track.wav', 'audio', 'audio/wav'], ['poster.png', 'image', 'image/png'], ['brief.pdf', 'pdf', 'application/pdf']]) {
    const result = artifactContent(name!, 'data:application/octet-stream;base64,AAECA/8=');
    assert.equal(result.kind, kind);
    assert.equal(result.blob?.type, mime);
    assert.deepEqual([...new Uint8Array(await result.blob!.arrayBuffer())], [0, 1, 2, 3, 255]);
  }
});

test('subtitle and source records decode as text, unknown binaries offer download', () => {
  const text = '1\n00:00:00,000 --> 00:00:01,000\nHello ☀\n';
  const record = `data:application/octet-stream;base64,${Buffer.from(text).toString('base64')}`;
  assert.equal(artifactContent('captions.srt', record).text, text);
  assert.equal(artifactContent('source.js', record).binary, false);
  assert.equal(artifactContent('bundle.zip', record).kind, 'download');
  assert.equal(artifactContent('README.md', '').text, '');
});

test('malformed data is an explicit error and URL bodies never become fetched media', () => {
  assert.match(artifactContent('clip.mp4', 'data:video/mp4;base64,!!').error!, /decoded/);
  assert.equal(artifactContent('clip.mp4', 'https://example.com/clip.mp4').kind, null);
  assert.equal(artifactContent('poster.png', '<script>alert(1)</script>').kind, null);
});
