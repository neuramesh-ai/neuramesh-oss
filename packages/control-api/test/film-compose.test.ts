// The product shots (film-compose.ts, plan §9): the frame renders portrait on the ground, the timeline
// cuts the film around each shot, the compose runs fal's utilities in order with the film's audio
// under all of it, and every failure names itself. A fake fal answers the storage and the utilities.
import { describe, expect, it } from 'vitest';
import { composeShots, imageSize, productFrameSvg, renderProductFrame, timeline, FRAME_H, FRAME_W } from '../src/film-compose';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** fal, faked: the storage lane, the three utilities and the compose, every call recorded */
function fakeFal(opts: { failAt?: string } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    if (opts.failAt && url.includes(opts.failAt)) return json({ detail: 'nope' }, 422);
    if (url.includes('/storage/upload/initiate')) return json({ upload_url: 'https://v3b.fal.media/up/frame.png?sig=1', file_url: 'https://v3b.fal.media/files/frame.png' });
    if (url.includes('/up/frame.png')) return new Response('', { status: 200 });
    if (url.includes('trim-video')) return json({ video: { url: `https://v3b.fal.media/files/trim-${body.start_time}-${body.end_time}.mp4` }, trimmed_duration: body.end_time - body.start_time });
    if (url.includes('images-to-video')) return json({ video: { url: `https://v3b.fal.media/files/shot-${body.images[0].frames}.mp4` } });
    if (url.includes('ffmpeg-api/compose')) return json({ video_url: 'https://v3b.fal.media/files/composed.mp4', thumbnail_url: 'x' });
    return json({ detail: 'unexpected call' }, 500);
  };
  return { fetchFn, calls };
}

describe('the product frame', () => {
  it('reads a PNG or JPEG header for its size', () => {
    expect(imageSize(PNG)).toEqual({ w: 1, h: 1 });
    // a JPEG's SOF0 marker carries height then width
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    expect(imageSize(`data:image/jpeg;base64,${jpeg.toString('base64')}`)).toEqual({ w: 1280, h: 800 });
    expect(imageSize('data:image/webp;base64,AAAA')).toBe(null);
    expect(imageSize('nope')).toBe(null);
  });
  it('fits a portrait or square image whole; shows a wide one as a centered 4:5 close-up, never stretched', async () => {
    const svg = productFrameSvg(PNG);
    expect(svg).toMatch(/width="720" height="1280"/);
    expect(svg).toMatch(/preserveAspectRatio="xMidYMid meet"/);
    expect(svg).toMatch(/fill="#141414"/);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x20, 0x05, 0x00, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
    const wide = productFrameSvg(`data:image/jpeg;base64,${jpeg.toString('base64')}`);
    expect(wide).toMatch(/preserveAspectRatio="xMidYMid slice"/);
    expect(wide).toMatch(/<image x="29" y="226" width="662" height="828"/); // a 4:5 window, centered in the 1280
    const png = await renderProductFrame(PNG);
    // a PNG, with the canvas's own size in its header (big-endian width and height at bytes 16 and 20)
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([FRAME_W, FRAME_H]);
  });
});

describe('the timeline', () => {
  const shot = (start: number, end: number, show = 'app.png') => ({ start, end, show, dataUrl: PNG });
  it('cuts the film around each shot, in order, clamped to the film, overlaps to the earlier shot, hairs dropped', () => {
    expect(timeline(15, [shot(3, 7)])).toEqual([{ kind: 'film', start: 0, end: 3 }, { kind: 'shot', start: 3, end: 7, shot: shot(3, 7) }, { kind: 'film', start: 7, end: 15 }]);
    expect(timeline(15, [shot(11, 20, 'b.png'), shot(3, 7)]).map((p) => [p.kind, p.start, p.end])).toEqual([['film', 0, 3], ['shot', 3, 7], ['film', 7, 11], ['shot', 11, 15]]);
    expect(timeline(15, [shot(0, 15)]).map((p) => p.kind)).toEqual(['shot']);
    expect(timeline(15, [shot(3, 7), shot(5, 9, 'b.png')]).map((p) => [p.kind, p.start, p.end])).toEqual([['film', 0, 3], ['shot', 3, 7], ['shot', 7, 9], ['film', 9, 15]]);
    expect(timeline(8, [shot(20, 25)])).toEqual([{ kind: 'film', start: 0, end: 8 }]);
    expect(timeline(15, [shot(14.9, 20)]).map((p) => [p.kind, p.start, p.end])).toEqual([['film', 0, 15]]); // a tenth of a second is not a cut
  });
});

describe('the compose', () => {
  it('frames and uploads each image once, trims the film around the shots, holds each frame for its window, and composes with the film\'s audio', async () => {
    const fal = fakeFal();
    const r = await composeShots('key', 'https://v3b.fal.media/files/clip.mp4', 15, [{ start: 3, end: 7, show: 'app.png', dataUrl: PNG }, { start: 11, end: 15, show: 'app.png', dataUrl: PNG }], { fetchFn: fal.fetchFn });
    expect(r).toEqual({ url: 'https://v3b.fal.media/files/composed.mp4', applied: 2 });
    const urls = fal.calls.map((c) => c.url.replace('https://', '').replace(/\?.*$/, ''));
    expect(urls).toEqual([
      'rest.alpha.fal.ai/storage/upload/initiate', 'v3b.fal.media/up/frame.png', // one upload for the one image
      'fal.run/fal-ai/workflow-utilities/trim-video', 'fal.run/fal-ai/ffmpeg-api/images-to-video', 'fal.run/fal-ai/workflow-utilities/trim-video', 'fal.run/fal-ai/ffmpeg-api/images-to-video',
      'fal.run/fal-ai/ffmpeg-api/compose',
    ]);
    expect(fal.calls[2]!.body).toEqual({ video_url: 'https://v3b.fal.media/files/clip.mp4', start_time: 0, end_time: 3 });
    expect(fal.calls[3]!.body).toEqual({ fps: 24, images: [{ url: 'https://v3b.fal.media/files/frame.png', frames: 96 }] });
    expect(fal.calls[4]!.body).toMatchObject({ start_time: 7, end_time: 11 });
    const compose = fal.calls[6]!.body as { tracks: Array<{ id: string; type: string; keyframes: Array<{ timestamp: number; url: string; duration: number }> }> };
    expect(compose.tracks[0]!.keyframes).toEqual([
      { timestamp: 0, url: 'https://v3b.fal.media/files/trim-0-3.mp4', duration: 3000 },
      { timestamp: 3000, url: 'https://v3b.fal.media/files/shot-96.mp4', duration: 4000 },
      { timestamp: 7000, url: 'https://v3b.fal.media/files/trim-7-11.mp4', duration: 4000 },
      { timestamp: 11000, url: 'https://v3b.fal.media/files/shot-96.mp4', duration: 4000 },
    ]);
    expect(compose.tracks[1]).toEqual({ id: 'audio', type: 'audio', keyframes: [{ timestamp: 0, url: 'https://v3b.fal.media/files/clip.mp4', duration: 15000 }] });
  });
  it('a failing step names itself and applies nothing; a shot outside the film applies nothing', async () => {
    expect(await composeShots('key', 'https://v3b.fal.media/files/clip.mp4', 15, [{ start: 3, end: 7, show: 'app.png', dataUrl: PNG }], { fetchFn: fakeFal({ failAt: 'trim-video' }).fetchFn })).toEqual({ applied: 0, why: 'the film did not trim at 0-3 s (nope)' });
    expect(await composeShots('key', 'https://v3b.fal.media/files/clip.mp4', 15, [{ start: 3, end: 7, show: 'app.png', dataUrl: PNG }], { fetchFn: fakeFal({ failAt: 'upload/initiate' }).fetchFn })).toEqual({ applied: 0, why: 'the product frame did not upload (nope)' });
    expect(await composeShots('key', 'https://v3b.fal.media/files/clip.mp4', 8, [{ start: 20, end: 25, show: 'app.png', dataUrl: PNG }], { fetchFn: fakeFal().fetchFn })).toEqual({ applied: 0, why: 'no product beat fell inside the film' });
  });
});
