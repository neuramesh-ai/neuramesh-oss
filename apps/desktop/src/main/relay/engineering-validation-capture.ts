// A disposable Chromium profile can reach only this checkout's assets or the approved preview origin.
import { createServer } from 'node:http';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { evaluatePolicy, type PolicyRule } from '@neuramesh/shared';
import { z } from 'zod';
import { jsonSchemaFor } from '../harness/toolschema';
import { chromiumBin, launchChromium } from '../browser/chromium';
import { startEgressProxy, type EgressProxy } from '../browser/egress-proxy';
import { checkUrl, resolveAllowed } from '../browser/address-guard';
import { BrowserPage } from '../browser/page';
import type { EngineeringConversation } from './engineering-conversation';
import type { EngineeringDisplayTool } from './engineering-display';
import { git } from '../host/gh';

const input = z.object({
  phase: z.enum(['before', 'after']), view: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}$/),
  previewOrigin: z.string().max(2048).optional().describe('For a local build omit this field or use an empty string. Only provide an HTTPS origin for an actual deployed preview.'),
  root: z.string().min(1).max(512), route: z.string().startsWith('/').max(1000),
  width: z.number().int().min(320).max(1920), height: z.number().int().min(240).max(1400),
  theme: z.enum(['light','dark']).optional(),
  interaction: z.object({
    click: z.string().min(1).max(320).describe('CSS selector of a visible control in this local preview.'),
    expectVisible: z.string().min(1).max(320).describe('Selector that must be visible after the click. Include the expected state in the selector.'),
  }).strict().optional(),
}).strict();
const media: Record<string,string> = { '.html':'text/html', '.htm':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2' };
const within = (root: string, path: string) => path === root || path.startsWith(root + sep);

function localAssetServer(repo: string, root: string, origin: string, rules: readonly PolicyRule[]) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '');
      if (req.method !== 'GET' || url.origin !== origin) { res.writeHead(403); res.end(); return; }
      const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      if (parts.some(p => p.startsWith('.') || p.includes('\\') || p.includes('\0') || p === 'node_modules')) throw new Error();
      let file = join(root,...parts);
      if (!extname(file) && !(await lstat(file).catch(() => null))?.isDirectory()) file += '.html';
      if ((await lstat(file)).isDirectory()) file = join(file, 'index.html');
      const path = await realpath(file), mime = media[extname(path)];
      if (!within(root,path) || relative(root,path).split(sep).some(part => part.startsWith('.') || part === 'node_modules') || !mime || evaluatePolicy({capability:'fs.read',path:relative(repo,path)},rules).verdict !== 'allow') { res.writeHead(403); res.end(); return; }
      const info = await lstat(path);
      if (!info.isFile() || info.nlink !== 1 || info.size > 16*1024*1024) throw new Error();
      const bytes = await readFile(path);
      res.writeHead(200, {'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}); res.end(bytes);
    } catch (error) {
      const missing = ['ENOENT','ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');
      res.writeHead(missing ? 404 : 403, {'Content-Type':'text/plain'});
      res.end(missing ? 'Page not found' : 'Preview access denied');
    }
  });
  server.on('connect',(_req,socket)=>socket.destroy());
  return server;
}

async function verifyInteraction(page: BrowserPage, interaction: NonNullable<z.infer<typeof input>['interaction']>) {
  const point = await page.evaluate<{x:number;y:number}>(`(() => {
    const el = document.querySelector(${JSON.stringify(interaction.click)});
    if (!el) return null;
    el.scrollIntoView({block:'center'});
    const r = el.getBoundingClientRect(), x = r.x + r.width/2, y = r.y + r.height/2;
    return r.width && r.height && el.contains(document.elementFromPoint(x,y)) ? {x,y} : null;
  })()`);
  if (!point) throw new Error('The requested control is missing, hidden or covered.');
  await page.mouse('down',point.x,point.y,'left');
  await page.mouse('up',point.x,point.y,'left');
  const visible = await page.evaluate<boolean>(`(async () => {
    for (let i=0; i<30; i++) {
      const el = document.querySelector(${JSON.stringify(interaction.expectVisible)});
      if (el && el.checkVisibility({visibilityProperty:true,opacityProperty:true}) && el.getBoundingClientRect().width) return true;
      await new Promise(r=>setTimeout(r,100));
    }
    return false;
  })()`);
  if (!visible) throw new Error('The expected state did not appear after the click.');
}

async function saveCapture(repo: string, name: string, phase: string, bytes: Buffer, rules: readonly PolicyRule[]) {
  let dir=repo;
  for (const part of ['.nm-artifacts','validation',phase]) {
    dir=join(dir,part); await mkdir(dir).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
    if ((await realpath(dir))!==dir) throw new Error('The evidence path leaves the worktree.');
  }
  const destination = join(repo,'.nm-artifacts',name);
  if (evaluatePolicy({capability:'fs.write',path:relative(repo,destination)},rules).verdict !== 'allow') throw new Error('Workspace policy restricts this evidence path.');
  const temp = join(dir,'.capture-'+randomUUID());
  const file = await open(temp,'wx',0o600);
  try {await file.writeFile(bytes);} finally {await file.close();}
  await rename(temp,destination);
}

export function validationCaptureTool(cwd: string, rules: readonly PolicyRule[], conversation: EngineeringConversation, baseRef?: string): EngineeringDisplayTool {
  return {
    name: 'capture_task_view',
    description: 'Capture the rendered website with real Chromium from the repository or its static web build. Set root to the web asset directory and route to the actual page. Capture before editing and again after the change using the same view name, dimensions and theme. For a server-rendered app use its actual deployment previewOrigin and route. If capture is unavailable, report the blocker. Never generate replacement pixels. For a local interaction, supply a click selector and the expected visible state. Never create a stand-in HTML page.',
    inputSchema: jsonSchemaFor(input.shape),
    execute: async raw => {
      const i = input.parse(raw);
      const repo = await realpath(cwd), root = await realpath(resolve(repo, i.root));
      if (!within(repo, root) || relative(repo, root).split(sep).some(p => p.startsWith('.') && p !== '.next')) throw new Error('Select a web build or public directory in this repository.');
      if (i.phase === 'before' && (await git(['status','--porcelain','--untracked-files=normal','--','.',':(exclude).nm-artifacts/**'],repo))) throw new Error('The worktree already has changes. Capture the unchanged base revision before editing.');
      if (i.phase === 'before' && baseRef) {
        const head = await git(['rev-parse','HEAD'],repo);
        const base = await git(['merge-base','HEAD',`refs/remotes/origin/${baseRef}`],repo);
        if (head !== base) throw new Error('This worktree contains a previous implementation. Use the original baseline images or capture the unchanged base in the project’s UI harness.');
      }
      if (i.interaction && i.previewOrigin) throw new Error('Run interactive validation against a local build or the project’s isolated UI test harness.');
      const bin = chromiumBin();
      if (!bin) throw new Error('Chromium is unavailable on this machine. Report the browser verification as blocked.');
      const remote = i.previewOrigin ? new URL(i.previewOrigin) : null;
      if (remote && (remote.protocol !== 'https:' || remote.href !== remote.origin+'/' || !checkUrl(remote.href).ok)) throw new Error('Use the HTTPS origin of the approved deployment preview.');
      const origin = remote?.origin ?? ('http://' + randomUUID() + '.invalid');
      const target = new URL(i.route, origin);
      if (target.origin !== origin) throw new Error('Use a route in this project.');
      const server = localAssetServer(repo, root, origin, rules);
      const profileDir = await mkdtemp(join(tmpdir(),'nm-task-capture-'));
      let proxy: EgressProxy | undefined;
      let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
      try {
        if (remote) proxy = await startEgressProxy({resolve: async host => {
          if (host !== remote.hostname || evaluatePolicy({capability:'net.egress',host},rules).verdict === 'deny') return {ok:false,reason:'Outside this preview origin or restricted by workspace policy.'};
          return resolveAllowed(host);
        }});
        else await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
        const address=server.address(), port=proxy?.port ?? (address && typeof address !== 'string' ? address.port : null);
        if (!port) throw new Error('Preview did not start.');
        browser = await launchChromium({bin,profileDir,proxyPort:port,width:i.width,height:i.height});
        const page = await BrowserPage.open(browser.cdp,'agent',{width:i.width,height:i.height});
        if (i.theme) {
          const {targetInfos}=await browser.cdp.send('Target.getTargets');
          const {sessionId}=await browser.cdp.send('Target.attachToTarget',{targetId:targetInfos.find((t:{type:string})=>t.type==='page').targetId,flatten:true});
          await browser.cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:i.theme}]},sessionId);
        }
        const nav = await page.navigate(target.href,12_000);
        if (!nav.ok || !page.doc || (page.doc.status >= 400 && !(i.phase==='before' && page.doc.status===404))) throw new Error('The requested project route did not render. Check the web root, build and route.');
        await page.evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true)))))');
        if (i.interaction) await verifyInteraction(page, i.interaction);
        const shot = await page.screenshot(270_000);
        const name = `validation/${i.phase}/${i.view}.${shot.mime === 'image/png' ? 'png' : 'jpg'}`;
        await saveCapture(repo, name, i.phase, shot.data, rules);
        const saved = await conversation.publishArtifact(name, {sha256:createHash('sha256').update(shot.data).digest('hex'), target:JSON.stringify({route:i.route,width:i.width,height:i.height,theme:i.theme ?? 'system'})});
        return {name,artifactId:saved.id,markdown:`[${i.phase} · ${i.view}](.nm-artifacts/${name})`,route:i.route,status:page.doc.status,...(i.interaction ? {verifiedInteraction:i.interaction} : {})};
      } finally {
        try {await browser?.close();} finally {if (server.listening) {server.closeAllConnections();server.close();} await proxy?.close();await rm(profileDir,{force:true,recursive:true});}
      }
    },
  };
}
