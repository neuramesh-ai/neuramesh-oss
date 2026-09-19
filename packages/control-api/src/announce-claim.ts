// The claim (docs/design/release-drafts-2026-09 §4.8, "sign in to save and schedule"): a ready
// announcement becomes a workspace's own rows through the ORDINARY commands, as the human who
// signed in: a project named for the repository, its marketing room (which plants the setup task
// by the docs/39 rule), the repository linked, the website and the repository written onto the
// setup flow, the session opened with the digest, the brief shelved as an artifact and carded,
// one content item per post, and the release card attached to the Instagram one.
import { createEvent, formatAddress, releaseDigest, briefMarker, type Actor, type ScanResult, type ReleaseCandidate } from '@neuramesh/shared';
import { CommandSchema } from './commands';
import { executeCommand } from './handler';
import type { Store } from './store';
import type { AnnounceStore, AnnouncementRow } from './store/announce';

type Out = Record<string, unknown>;
// through the SAME schema the route applies: it fills the defaults the handlers rely on (an empty
// description, empty channel lists) and refuses what the route would refuse. Bypassing it handed
// postgres an undefined description and the claim answered 500 on the live harness (2026-09-18).
const run = async (store: Store, actor: Actor, cmd: Record<string, unknown>): Promise<Out> => {
  const parsed = CommandSchema.safeParse(cmd);
  if (!parsed.success) throw new Error(`the claim built an invalid ${String(cmd['type'])}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join(', ')}`);
  return (await executeCommand(store, actor, parsed.data)) as unknown as Out;
};

export async function claimAnnouncement(store: Store, ann: AnnounceStore, actor: Actor, workspace: string, row: AnnouncementRow): Promise<{ threadId: string; channelId: string; projectId: string }> {
  const short = row.repo.split('/')[1] ?? row.repo;
  const website = /^https?:\/\//i.test(row.website) ? row.website : `https://${row.website}`;
  const project = await run(store, actor, { type: 'project.create', workspace, name: short.slice(0, 80), website });
  const projectId = String(project['projectId']);
  const channel = await run(store, actor, { type: 'channel.create', workspace, project: projectId, slug: 'marketing', topic: `Release drafts for ${row.repo}` });
  const channelId = String(channel['channelId']);
  await run(store, actor, { type: 'channel.set_kind', channel: channelId, kind: 'marketing' });
  const repo = await run(store, actor, { type: 'repo.link', workspace, project: projectId, url: `https://github.com/${row.repo}` }).catch(() => ({} as Out));
  const repoId = repo['repoId'] ? String(repo['repoId']) : null;
  await run(store, actor, { type: 'setup.step', channel: channelId, flow: 'marketing.v1', step: 'product', value: website }).catch(() => undefined);
  if (repoId) await run(store, actor, { type: 'setup.step', channel: channelId, flow: 'marketing.v1', step: 'releases', value: { repoId, slug: row.repo, now: false, watch: false } }).catch(() => undefined);
  // the session: the digest as the first message, the way the routine's fire opens one
  const threadId = crypto.randomUUID();
  const digest = row.digest as { candidate?: ReleaseCandidate; skipped?: number } | null;
  const scan: ScanResult | null = digest?.candidate ? { candidates: [digest.candidate], skipped: [], cursor: { at: row.createdAt, tag: digest.candidate.tag } } : null;
  const tag = row.tag ?? 'the latest release';
  const body = scan
    ? `Release drafts · ${tag} · ${row.repo}\n\n${releaseDigest(row.repo, scan, { since: null, checkedAt: 'on the site' })}`
    : `Release drafts · ${tag} · ${row.repo}\n\nDrafted at neuramesh.app/announce.`;
  const post = (text: string) => store.postMessage(
    { id: crypto.randomUUID(), workspace, channel: channelId, taskId: null, threadId, author: { kind: actor.kind, id: actor.id }, body: text, createdAt: new Date().toISOString(), threadOrigin: null },
    createEvent({ type: 'message.posted', source: formatAddress({ kind: actor.kind, id: actor.id }), target: `channel/${channelId}`, workspace, payload: { preview: text.slice(0, 120) } }),
  );
  await post(body);
  if (row.brief) {
    const art = await run(store, actor, { type: 'artifact.create', channel: channelId, kind: 'file', name: `release-report-${row.createdAt.slice(0, 10)}.md`, inlineContent: row.brief, mime: 'text/markdown', tags: ['release'] }).catch(() => ({} as Out));
    if (art['artifactId']) await post(`The brief is in. ${briefMarker(String(art['artifactId']))}`);
  }
  const image = await ann.image(row.id);
  for (const p of row.posts) {
    const item = await run(store, actor, { type: 'content.create', channel: channelId, thread: threadId, platform: p.platform, body: p.body, ...(p.imageBrief ? { imageBrief: p.imageBrief } : {}) }).catch(() => ({} as Out));
    if (image && p.platform === 'instagram' && item['itemId']) {
      const dataUrl = `data:${image.mime};base64,${Buffer.from(image.bytes).toString('base64')}`;
      // the card without its image is still a draft the person can redraw, but the reason is logged, never swallowed
      await run(store, actor, { type: 'content.attach_media', item: String(item['itemId']), dataUrl }).catch((e: unknown) => console.warn(`announce ${row.id}: the release card did not attach: ${e instanceof Error ? e.message : String(e)}`));
    }
  }
  await ann.claim(row.id, { userId: actor.id, workspaceId: workspace, threadId });
  return { threadId, channelId, projectId };
}
