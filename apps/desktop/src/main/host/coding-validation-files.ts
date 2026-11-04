import { readFile, readdir, lstat, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { imageDataUri } from '../agents';
import { git } from './gh';
import { EVIDENCE_IMAGE_BUDGET, IMAGE_EXT, planEvidenceBudget, sweepEvidenceImages } from '../evidence';
import { createHash } from 'node:crypto';
import { apiAuthHeaders } from '../apiauth';
import type { HostCtx } from './ctx';
import { brainApiBaseUrl, validationImages, requireCaptureReceipts, type CaptureReceipt } from '@neuramesh/shared';

export class CodingEvidenceBlocked extends Error {}

export async function reportBlockedEvidence(post: HostCtx['post'], actor: {kind: string; id: string; role: string}, taskId: string, channel: {id: string; workspace_id: string}, error: CodingEvidenceBlocked) {
  const reason = `Validation blocked. ${error.message} The implementation is saved on this machine for the next attempt.`;
  const result = await post('/v1/commands',actor,{type:'task.block',taskId,reason:reason.slice(0,500)});
  if (!result.ok) throw new Error(`Could not record the blocked validation (HTTP ${result.status}).`);
  await post('/v1/messages',actor,{workspace:channel.workspace_id,channel:channel.id,taskId,body:reason});
}

/** Use the immutable image digest recorded for this thread by the managed browser. */
export async function taskCaptureReceipts(apiUrl: string, workspace: string, threadId: string, userId: string): Promise<CaptureReceipt[]> {
  const url = new URL(`/v1/brain/threads/${threadId}/artifacts`, brainApiBaseUrl(apiUrl));
  url.searchParams.set('workspace',workspace);
  const response = await fetch(url,{headers:await apiAuthHeaders(apiUrl,{kind:'human',id:userId}),signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Could not verify the task’s browser captures (HTTP ${response.status}).`);
  const {artifacts} = await response.json() as {artifacts: {name:string;sha256:string;capture?: CaptureReceipt}[]};
  return artifacts.flatMap(a => a.capture && a.capture.name === a.name ? [a.capture] : []);
}

export async function codingValidationFiles(cwd: string, required: boolean, startedAt?: number, receipts?: () => Promise<CaptureReceipt[]>) {
  try { return await readCodingScreenshots(cwd,required,startedAt,receipts); }
  catch (error) { throw new CodingEvidenceBlocked(error instanceof Error ? error.message : 'Visual verification is incomplete.'); }
}

async function readCodingScreenshots(cwd: string, required: boolean, startedAt?: number, receipts?: () => Promise<CaptureReceipt[]>) {
  const root = await realpath(cwd);
  const shots: {kind:'screenshot'; name:string; content:string}[] = [];
  for (const phase of ['before','after']) {
    const dir = join(root,'.nm-artifacts','validation',phase);
    const actual = await realpath(dir).catch((error:NodeJS.ErrnoException) => { if (error.code==='ENOENT') return null; throw error; });
    if (!actual) continue;
    if (actual !== dir) throw new Error('Screenshot folders must stay inside the worktree.');
    for (const item of await readdir(dir,{withFileTypes:true})) {
      if (!/^[a-z0-9][a-z0-9-]{0,59}\.(?:png|jpe?g)$/i.test(item.name)) continue;
      const path = join(dir,item.name), stat = await lstat(path);
      if (!item.isFile() || stat.nlink !== 1 || stat.size > 290_000 || shots.length >= 16) throw new Error('Use at most eight before/after pairs of regular screenshot files under 290 KB each.');
      if (phase === 'after' && startedAt !== undefined && stat.mtimeMs < startedAt) {
        throw new Error(`Capture ${item.name} again after this implementation. Its saved screenshot belongs to an earlier revision.`);
      }
      const mime = /\.png$/i.test(item.name) ? 'image/png' : 'image/jpeg';
      shots.push({kind:'screenshot',name:`validation/${phase}/${item.name}`,content:`data:${mime};base64,${(await readFile(path)).toString('base64')}`});
    }
  }
  if (shots.length) {
    const verified = await receipts?.() ?? [];
    requireCaptureReceipts(shots.map(shot=>({name:shot.name,
      sha256:createHash('sha256').update(Buffer.from(shot.content.split(',')[1]!, 'base64')).digest('hex')})), verified, startedAt);
  }
  const names = validationImages(shots);
  if (required && !names.length) throw new Error('Visual validation is incomplete. Capture the real application before and after under .nm-artifacts/validation and publish both screenshots before submitting.');
  return shots;
}

export function prValidationSection(slug: string, sha: string, names: string[]) {
  if (!names.length) return '';
  const rows = names.map(name => {
    const [_,phase,file] = name.split('/');
    const url = `https://github.com/${slug}/blob/${sha}/.nm-artifacts/${name}?raw=true`;
    return `**${phase} · ${file}**\n\n![${phase} ${file}](${url})`;
  });
  return '\n\n<!-- nm-validation:start -->\n## Implementation evidence\n\n' + rows.join('\n\n') + '\n<!-- nm-validation:end -->';
}

export async function legacyTaskScreenshots(dir: string, droppedEvidence: string[]) {
  const files: {kind:'screenshot';name:string;content:string}[] = [];
  const changed = (await git(['status', '--porcelain', '--untracked-files=all'], dir).catch(() => ''))
    .split('\n').map((l) => l.slice(3).trim()).filter((p) => p && IMAGE_EXT.test(p));
  const evRels = await sweepEvidenceImages(join(dir, '.nm-evidence'));
  const pool = planEvidenceBudget([
    ...changed.map((rel) => ({ path: join(dir, rel), name: rel.split('/').pop() ?? rel, inTree: true })),
    ...evRels.map((rel) => ({ path: join(dir, '.nm-evidence', rel), name: rel, inTree: false })),
  ], EVIDENCE_IMAGE_BUDGET);
  for (const img of pool.take) {
    const uri = imageDataUri(img.path);
    if (uri) files.push({ kind: 'screenshot', name: img.name, content: uri });
    else droppedEvidence.push(`${img.name} (unreadable/oversize)`);
  }
  droppedEvidence.push(...pool.dropped.map((img) => img.name));
  for (const img of [...pool.take, ...pool.dropped]) {
    if (img.inTree) await rm(img.path, { force: true }).catch(() => {});
  }
  return files;
}
