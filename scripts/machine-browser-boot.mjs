#!/usr/bin/env node
// the machine image's browser boots (models-and-replies round, board C3). it runs the daemon's own
// browser service inside a built machine image, as the image's root user: it starts Chromium over
// the CDP pipe, captures one screencast frame, opens a public page through the egress proxy, and asks
// for the metadata server, which the address guard must refuse, from the panel's path and an agent's.
//
//   docker build -f infra/images/machine/Dockerfile -t nm-machine:dev .
//   node scripts/machine-browser-boot.mjs nm-machine:dev [frame.jpg]
//
// exit 0 = every claim held. exit 1 = a claim failed, with what the image said. it runs under the
// local Docker runtime: gVisor's own behaviour shows only when the fleet boots the image.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [image, outFile] = process.argv.slice(2);
if (!image) { console.error('usage: node scripts/machine-browser-boot.mjs <image> [frame.jpg]'); process.exit(2); }

// runs inside the image, from /app/apps/desktop, with the image's own tsx
const PROBE = String.raw`(async () => {
const { createBrowserService } = await import('/app/apps/desktop/src/main/browser/service.ts');
const { webToolsFor } = await import('/app/apps/desktop/src/main/browser/agent-tools.ts');
const t0 = Date.now();
const svc = createBrowserService({ bin: '/usr/bin/chromium', stateDir: '/tmp/nm-state', log: (line) => console.error('[browser] ' + line) });
const out = {};
try {
  const { page, release } = await svc.person('boot-check', { width: 800, height: 600 });
  out.startMs = Date.now() - t0;
  // one viewer stays for the whole probe, as the panel does: the last viewer to leave stops the screencast
  const frames = [];
  const stopWatch = page.watchFrames((f) => frames.push(f));
  const until = async (test, ms, what) => { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) throw new Error(what); await new Promise((r) => setTimeout(r, 100)); } };
  await until(() => frames.length > 0, 20000, 'no screencast frame in 20 s');
  const frame = frames[0];
  out.firstFrame = { w: frame.w, h: frame.h, jpegBytes: Buffer.from(frame.jpeg, 'base64').length, jpeg: frame.jpeg.startsWith('/9j/') };
  const before = frames.length;
  out.example = await page.navigate('https://example.com/', 20000);
  out.exampleTitle = page.state.title;
  await until(() => frames.length > before && Buffer.from(frames[frames.length - 1].jpeg, 'base64').length > out.firstFrame.jpegBytes, 10000, 'no frame of the loaded page');
  out.framesAfterNavigation = frames.length - before;
  out.frame = frames[frames.length - 1].jpeg;
  stopWatch();
  out.metadataPanel = await page.navigate('http://169.254.169.254/computeMetadata/v1/');
  const web = webToolsFor({ agentName: 'boot-check', attach: async () => null, savedWhere: '' }, svc);
  out.metadataAgent = await web.open({ url: 'http://metadata.google.internal/computeMetadata/v1/' });
  out.agentOpen = (await web.open({ url: 'https://example.com/' })).slice(0, 80);
  release();
} catch (e) { out.error = e instanceof Error ? e.message : String(e); }
finally { await svc.close(); }
console.log('NM_BOOT ' + JSON.stringify(out));
})();
`;

const run = spawnSync('docker', ['run', '--rm', '--entrypoint', 'tsx', image, '-e', PROBE], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const line = (run.stdout ?? '').split('\n').find((l) => l.startsWith('NM_BOOT '));
if (!line) { console.error(`[machine-browser-boot] no answer from the image (exit ${run.status})\n${(run.stderr ?? '').slice(-2000)}`); process.exit(1); }
const out = JSON.parse(line.slice('NM_BOOT '.length));
const frame = out.frame;
delete out.frame;
console.log(`[machine-browser-boot] ${JSON.stringify(out, null, 2)}`);
if (outFile && frame) { writeFileSync(outFile, Buffer.from(frame, 'base64')); console.log(`[machine-browser-boot] wrote ${outFile}`); }

const claims = [
  [!out.error, `the service ran (${out.error ?? 'no error'})`],
  [out.firstFrame?.jpeg && out.firstFrame.w === 800 && out.firstFrame.h === 600, 'Chromium started over the pipe and sent an 800 × 600 JPEG screencast frame'],
  [out.example?.ok === true && out.exampleTitle === 'Example Domain', `a public page opened through the egress proxy (${out.exampleTitle})`],
  [out.metadataPanel?.ok === false && /private or local/.test(out.metadataPanel.reason), 'the panel path refused the metadata server'],
  [/^The address was refused: metadata\.google\.internal/.test(out.metadataAgent ?? ''), 'an agent was refused the metadata server, in plain words'],
  [/^Title: Example Domain/.test(out.agentOpen ?? ''), 'an agent opened a public page and read it'],
];
let failed = 0;
for (const [ok, what] of claims) { console.log(`[machine-browser-boot] ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failed += 1; }
process.exit(failed ? 1 : 0);
