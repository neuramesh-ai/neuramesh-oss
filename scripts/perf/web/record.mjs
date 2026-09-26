// record.mjs: video capture of any scenario over CDP, with faithful timing.
//
//   const rec = new Recorder(cdp, pageSession, { dir: 'videos/frames-xyz' });
//   await rec.start();  ... drive the scenario ...  const frames = await rec.stop();
//   encodeMp4(frames, 'videos/xyz.mp4', { t0Wall, holdMs: 1000 });
//   filmstrip('videos/xyz.mp4', 'videos/xyz-filmstrip', { everyMs: 100 });
//
// Page.startScreencast (jpeg, quality 85, maxWidth 1440, everyNthFrame 1). Every frame is acked at
// once, and its metadata.timestamp (wall-clock seconds, the compositor's own) is kept. The screencast
// only emits on a visual change, so the MP4 is built with the concat demuxer and per-frame durations
// taken from those timestamps: a frame is shown until the next one arrived, exactly as the page looked.
// Then fps=30 makes it constant-frame-rate, H.264 yuv420p.
//
// sideBySide(a, b, out): two clips next to each other, "Before" / "After" labels and a running ms
// timer burned in. This ffmpeg build has no drawtext (no freetype), so the label + timer frames are
// drawn on a canvas in Chrome (already the harness's one dependency) and laid over with `overlay`.
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const FFMPEG = process.env['FFMPEG'] || '/usr/local/bin/ffmpeg';
const FFPROBE = process.env['FFPROBE'] || '/usr/local/bin/ffprobe';
const here = dirname(fileURLToPath(import.meta.url));

export class Recorder {
  constructor(cdp, sessionId, { dir, quality = 85, maxWidth = 1440, maxHeight = 900, everyNthFrame = 1 } = {}) {
    Object.assign(this, { cdp, sessionId, dir, quality, maxWidth, maxHeight, everyNthFrame });
    this.frames = [];
    this.off = null;
    this.acks = 0;
  }
  async start() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.off = this.cdp.on((m, p, sid) => {
      if (m !== 'Page.screencastFrame' || sid !== this.sessionId) return;
      // ack first: the next frame is only produced after the ack
      this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }, this.sessionId).catch(() => null);
      this.acks++;
      const file = join(this.dir, `f${String(this.frames.length).padStart(6, '0')}.jpg`);
      writeFileSync(file, Buffer.from(p.data, 'base64'));
      this.frames.push({ file, ts: p.metadata.timestamp, w: p.metadata.deviceWidth, h: p.metadata.deviceHeight, recvWall: Date.now() });
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: this.quality, maxWidth: this.maxWidth, maxHeight: this.maxHeight, everyNthFrame: this.everyNthFrame }, this.sessionId);
    this.startedWall = Date.now();
  }
  async stop() {
    await this.cdp.send('Page.stopScreencast', {}, this.sessionId).catch(() => null);
    await new Promise((r) => setTimeout(r, 300));
    this.off?.();
    this.stoppedWall = Date.now();
    return this.frames;
  }
}

/** frames → constant-frame-rate MP4. t0Wall/t1Wall (ms) extend the clip to a start/end in wall time:
 *  before the first frame the first frame is held (or a blank frame when blankBefore is set). */
export function encodeMp4(frames, out, { fps = 30, holdMs = 800, t0Wall = null, t1Wall = null, blankBefore = null, width = null } = {}) {
  if (!frames.length) throw new Error(`no frames for ${out}`);
  mkdirSync(dirname(out), { recursive: true });
  const listFile = `${out}.ffconcat`;
  const lines = ['ffconcat version 1.0'];
  const first = frames[0];
  if (t0Wall != null && first.ts * 1000 > t0Wall) {
    const lead = (first.ts * 1000 - t0Wall) / 1000;
    lines.push(`file '${blankBefore ?? first.file}'`, `duration ${lead.toFixed(4)}`);
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const next = frames[i + 1];
    let dur = next ? next.ts - f.ts : holdMs / 1000;
    if (!next && t1Wall != null) dur = Math.max(holdMs / 1000, t1Wall / 1000 - f.ts);
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, dur).toFixed(4)}`);
  }
  lines.push(`file '${frames[frames.length - 1].file}'`); // the demuxer needs the last file twice to honour its duration
  writeFileSync(listFile, lines.join('\n') + '\n');
  const scale = width ? `scale=${width}:-2` : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  // screencast JPEGs are full-range (yuvj420p): convert to limited-range yuv420p, the format every player expects
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `fps=${fps},${scale}:in_range=pc:out_range=tv,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-movflags', '+faststart', out]);
  rmSync(listFile, { force: true }); // it names frame files the caller is about to delete
  return { out, frames: frames.length, seconds: probeSeconds(out) };
}

export function probeSeconds(file) {
  try { return Number(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim()); } catch { return null; }
}

/** a PNG every `everyMs` from a CFR video, plus one contact sheet */
export function filmstrip(video, outDir, { everyMs = 100, sheetCols = 10, thumbWidth = 288 } = {}) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const fps = 1000 / everyMs;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${fps}`, join(outDir, 't%05d.png')]);
  const n = readdirSync(outDir).filter((f) => f.endsWith('.png')).length;
  const rows = Math.ceil(n / sheetCols);
  const sheet = `${outDir}-sheet.png`;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-vf', `fps=${fps},scale=${thumbWidth}:-2,tile=${sheetCols}x${rows}:padding=4:margin=4`, '-frames:v', '1', sheet]);
  return { dir: outDir, pngs: n, sheet };
}

/** draw label + running-timer frames on a canvas in the given page (any page), write them as PNGs */
export async function renderTimerFrames({ cdp, page, evaluate, outDir, label, seconds, fps = 30, w = 420, h = 64, color = '#ffffff', bg = 'rgba(0,0,0,0.72)' }) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const total = Math.ceil(seconds * fps);
  const batch = 60;
  for (let start = 0; start < total; start += batch) {
    const n = Math.min(batch, total - start);
    const urls = await evaluate(cdp, page, `(() => {
      const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
      const g = c.getContext('2d'); const out = [];
      for (let i = ${start}; i < ${start + n}; i++) {
        g.clearRect(0, 0, ${w}, ${h});
        g.fillStyle = ${JSON.stringify(bg)}; g.beginPath(); g.roundRect(0, 0, ${w}, ${h}, 10); g.fill();
        g.fillStyle = ${JSON.stringify(color)}; g.textBaseline = 'middle';
        g.font = '600 26px -apple-system, Helvetica, Arial, sans-serif'; g.fillText(${JSON.stringify(label)}, 18, ${h / 2});
        const ms = Math.round(i * 1000 / ${fps});
        g.font = '500 26px Menlo, monospace'; const t = (ms / 1000).toFixed(3) + ' s';
        g.textAlign = 'right'; g.fillText(t, ${w} - 18, ${h / 2}); g.textAlign = 'left';
        out.push(c.toDataURL('image/png'));
      }
      return out;
    })()`, { awaitPromise: false, timeoutMs: 120_000 });
    urls.forEach((u, k) => writeFileSync(join(outDir, `l${String(start + k).padStart(5, '0')}.png`), Buffer.from(u.split(',')[1], 'base64')));
  }
  return { dir: outDir, frames: total };
}

/** two clips side by side with labels + a running timer (both clips start at 0) */
export async function sideBySide({ a, b, out, labelA = 'Before', labelB = 'After', width = 1280, fps = 30, cdp, page, evaluate }) {
  const da = probeSeconds(a) ?? 0;
  const db = probeSeconds(b) ?? 0;
  const secs = Math.max(da, db);
  const work = `${out}.work`;
  mkdirSync(work, { recursive: true });
  const la = await renderTimerFrames({ cdp, page, evaluate, outDir: join(work, 'la'), label: labelA, seconds: secs, fps });
  const lb = await renderTimerFrames({ cdp, page, evaluate, outDir: join(work, 'lb'), label: labelB, seconds: secs, fps });
  const pad = (i, d) => `[${i}:v]fps=${fps},scale=${width}:-2:out_range=tv,format=yuv420p,tpad=stop_mode=clone:stop_duration=${Math.max(0, secs - d + 0.05).toFixed(3)}[v${i}]`;
  const graph = [
    pad(0, da), pad(1, db),
    `[v0][2:v]overlay=16:16:eof_action=repeat[o0]`,
    `[v1][3:v]overlay=16:16:eof_action=repeat[o1]`,
    `[o0][o1]hstack=inputs=2,format=yuv420p[out]`,
  ].join(';');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', a, '-i', b, '-framerate', String(fps), '-i', join(la.dir, 'l%05d.png'), '-framerate', String(fps), '-i', join(lb.dir, 'l%05d.png'),
    '-filter_complex', graph, '-map', '[out]', '-t', secs.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(fps), '-movflags', '+faststart', out]);
  rmSync(work, { recursive: true, force: true });
  return { out, seconds: probeSeconds(out) };
}

// CLI: node record.mjs sidebyside before.mp4 after.mp4 out.mp4 [--labels Before,After]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b, out] = process.argv.slice(2);
  if (cmd !== 'sidebyside' || !a || !b || !out) { console.error('usage: node record.mjs sidebyside before.mp4 after.mp4 out.mp4 [--labels Before,After]'); process.exit(2); }
  const li = process.argv.indexOf('--labels');
  const [labelA, labelB] = li > 0 ? process.argv[li + 1].split(',') : ['Before', 'After'];
  const { launchChrome, openPage, evaluate, closeChrome } = await import('./cdp.mjs');
  const chrome = await launchChrome({ port: 9359, userDataDir: resolve(here, 'profiles', 'sidebyside'), fresh: true });
  const { cdp, page } = await openPage(chrome);
  try {
    const r = await sideBySide({ a, b, out, labelA, labelB, cdp, page, evaluate });
    console.log(JSON.stringify(r));
  } finally { await closeChrome(chrome, cdp); }
}
