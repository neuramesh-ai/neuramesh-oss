// neuramesh.app/announce, the public door (docs/design/release-drafts-2026-09 §4.8): the detect,
// the form's queue, the page's read, the release card, the GitHub App's install callback, the
// minute cron that works the queue, and the claim a signed-in person makes. Public routes sit
// above the /v1 guard and wear the site's CORS (app.ts's rule: a browser-called route without it
// is invisible, not locked). The claim is a /v1 route, registered after the guard.
import type { Env, Hono } from 'hono';
import { cors } from 'hono/cors';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Actor } from '@neuramesh/shared';
import { defaultDeps, runAnnounceJob, type AnnounceDeps } from './announce-job';
import { claimAnnouncement } from './announce-claim';
import { actorInWorkspace } from './credits';
import { findInstallation, githubAppConfigured, githubGet, installUrl, installationToken, parseRepoInput } from './github-app';
import { APP_URL } from './mail';
import { queueAndSend } from './onauth';
import type { Store } from './store';
import type { AnnouncementRow } from './store/announce';

const siteOrigin = (origin: string): string | null =>
  origin === 'https://neuramesh.app' || origin === 'https://www.neuramesh.app' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : null;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const cap = (name: string, fallback: number): number => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : fallback; };
const ipHashOf = (ip: string | undefined): string | null => (ip ? createHash('sha256').update(ip.trim()).digest('hex').slice(0, 32) : null);
const maskEmail = (e: string): string => { const [u = '', d = ''] = e.split('@'); return `${u.slice(0, 1)}•••@${d}`; };

const CreateSchema = z.object({ repo: z.string().min(3).max(200), tag: z.string().max(120).nullable().optional(), website: z.string().trim().min(3).max(400), email: z.string().trim().max(200) });
const DetectSchema = z.object({ repo: z.string().min(3).max(200) });

interface Latest { tag: string; name: string | null; publishedAt: string }
type Fetch = typeof fetch;

/** the latest release (or tag) and the merged pull requests since it, at most three reads */
async function latestOf(slug: string, token: string | null, fetchFn: Fetch): Promise<{ latest: Latest | null; prs: number }> {
  const rel = await githubGet(`/repos/${slug}/releases?per_page=5`, { token, fetchFn });
  const rows = rel.status === 200 && Array.isArray(rel.json) ? (rel.json as Array<{ tag_name: string; name: string | null; published_at: string | null; draft: boolean; prerelease: boolean }>) : [];
  let latest: Latest | null = null;
  const first = rows.find((r) => r.published_at && !r.draft && !r.prerelease);
  if (first) latest = { tag: first.tag_name, name: first.name, publishedAt: first.published_at! };
  else {
    const tg = await githubGet(`/repos/${slug}/tags?per_page=1`, { token, fetchFn });
    const t = tg.status === 200 && Array.isArray(tg.json) ? (tg.json as Array<{ name: string }>)[0] : undefined;
    if (t) latest = { tag: t.name, name: null, publishedAt: '' };
  }
  let prs = 0;
  if (latest?.publishedAt) {
    const p = await githubGet(`/repos/${slug}/pulls?state=closed&sort=updated&direction=desc&per_page=50`, { token, fetchFn });
    if (p.status === 200 && Array.isArray(p.json)) prs = (p.json as Array<{ merged_at: string | null }>).filter((x) => x.merged_at && x.merged_at > latest!.publishedAt).length;
  }
  return { latest, prs };
}

/** what the page renders while it waits, and once it is done */
export function announceView(row: AnnouncementRow, brief: { title: string; verdict: string; why: string } | null): Record<string, unknown> {
  const s = row.status;
  const steps = {
    release: row.digest ? 'ready' : s === 'failed' ? 'next' : 'wait',
    site: row.brand ? 'ready' : s === 'queued' || s === 'reading' ? 'wait' : s === 'drafting' ? 'wait' : 'next',
    drafts: row.posts.length ? 'ready' : s === 'drafting' ? 'wait' : 'next',
    card: row.imageMime ? 'ready' : 'next',
  };
  const digest = row.digest as { candidate?: { tag: string | null; name: string; publishedAt: string } } | null;
  return {
    id: row.id, status: s, repo: row.repo, tag: row.tag, website: row.website, email: maskEmail(row.email), steps,
    latest: digest?.candidate ? { tag: digest.candidate.tag ?? row.tag, name: digest.candidate.name, publishedAt: digest.candidate.publishedAt } : null,
    brief, posts: row.posts.map((p) => ({ platform: p.platform, body: p.body, image: p.platform === 'instagram' && !!row.imageMime })),
    error: row.error, createdAt: row.createdAt, readyAt: row.readyAt, claimed: !!row.claimedThreadId,
  };
}

export function announceRoutes<E extends Env>(app: Hono<E>, store: Store, opts: { deps?: Partial<AnnounceDeps>; fetchFn?: Fetch } = {}): void {
  const fetchFn = opts.fetchFn ?? fetch;
  const ann = () => store.announcements;
  app.use('/announce/*', cors({ origin: siteOrigin, allowMethods: ['GET', 'POST', 'OPTIONS'] }));
  app.use('/announce', cors({ origin: siteOrigin, allowMethods: ['POST', 'OPTIONS'] }));

  // the App's installation for a repository: the row the callback wrote, else GitHub's own answer,
  // remembered with the installation's whole repository list the way the callback writes it. The
  // callback is not the only door: the grant can land on another deployment's callback, and on the
  // live install (2026-09-18) create read only the table, so the job read the private repository
  // anonymously and failed on 404 while detect said installed.
  const installationFor = async (slug: string): Promise<{ installationId: number } | null> => {
    if (!githubAppConfigured()) return null;
    const known = await ann()!.installationForRepo(slug);
    if (known) return known;
    const found = await findInstallation(slug, { fetchFn }).catch(() => null);
    if (!found) return null;
    try {
      const tok = await installationToken(found.id, { fetchFn });
      const repos = await githubGet('/installation/repositories?per_page=100', { token: tok.token, fetchFn });
      const names = ((repos.json as { repositories?: Array<{ full_name: string }> })?.repositories ?? []).map((r) => r.full_name);
      if (repos.status === 200 && names.length) await ann()!.upsertInstallation({ installationId: found.id, account: found.account, repos: names });
    } catch { /* the id is the answer; the memo is a convenience */ }
    return { installationId: found.id };
  };

  app.post('/announce/detect', async (c) => {
    if (!ann()) return c.json({ ok: false, reason: 'unconfigured' }, 501);
    const body = DetectSchema.safeParse(await c.req.json().catch(() => null));
    const parsed = body.success ? parseRepoInput(body.data.repo) : null;
    if (!parsed) return c.json({ ok: false, reason: 'invalid' });
    const slug = parsed.slug;
    let token: string | null = null;
    let repo = await githubGet(`/repos/${slug}`, { fetchFn });
    let installed = false;
    if (repo.status !== 200) {
      // a stranger sees 404 for a private repository and a missing one alike: the App's grant tells them apart
      const inst = await installationFor(slug);
      if (inst) {
        token = (await installationToken(inst.installationId, { fetchFn }).catch(() => null))?.token ?? null;
        if (token) { repo = await githubGet(`/repos/${slug}`, { token, fetchFn }); installed = repo.status === 200; }
      }
      if (repo.status !== 200) return c.json({ ok: true, slug, private: true, installed: false, latest: null, prs: 0, homepage: null, install: githubAppConfigured() ? installUrl(slug) : null });
    }
    const facts = repo.json as { private?: boolean; homepage?: string | null };
    const { latest, prs } = await latestOf(slug, token, fetchFn);
    return c.json({ ok: true, slug, private: !!facts.private, installed: installed || !facts.private, latest, prs, homepage: facts.homepage ?? null, install: null });
  });

  app.post('/announce', async (c) => {
    if (!ann()) return c.json({ error: 'The door is not open on this server.' }, 501);
    const body = CreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'Give the repository, your website and your email.' }, 422);
    const parsed = parseRepoInput(body.data.repo);
    if (!parsed) return c.json({ error: 'That is not a GitHub repository address.' }, 422);
    const email = body.data.email.toLowerCase();
    if (!EMAIL_RE.test(email)) return c.json({ error: 'That email address does not look right.' }, 422);
    const website = body.data.website.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(website)) return c.json({ error: 'That website address does not look right.' }, 422);
    const ipHash = ipHashOf(c.req.header('x-forwarded-for')?.split(',')[0] ?? c.req.header('x-real-ip'));
    const now = Date.now();
    const day = new Date(now - 86_400_000).toISOString();
    const hour = new Date(now - 3_600_000).toISOString();
    if ((await ann()!.countSince({ email, sinceIso: day })) >= cap('ANNOUNCE_EMAIL_CAP', 5)) return c.json({ error: 'This email already asked for five draft sets today. Try again tomorrow.' }, 429);
    if (ipHash && (await ann()!.countSince({ ipHash, sinceIso: hour })) >= cap('ANNOUNCE_IP_CAP', 10)) return c.json({ error: 'Too many requests from this address. Try again in an hour.' }, 429);
    if ((await ann()!.countSince({ sinceIso: day })) >= cap('ANNOUNCE_DAILY_CAP', 200)) return c.json({ error: 'The door is busy today. Try again tomorrow.' }, 429);
    const inst = await installationFor(parsed.slug);
    // a client that names no release (the terminal, CI, a plain curl) gets the latest one resolved
    // HERE, so the same release for the same email serves the existing row instead of a second one
    // whose job then trips the one-per-release index (the live re-run, 2026-09-18)
    let tag = body.data.tag ?? null;
    if (!tag) {
      const token = inst ? (await installationToken(inst.installationId, { fetchFn }).catch(() => null))?.token ?? null : null;
      tag = (await latestOf(parsed.slug, token, fetchFn).catch(() => ({ latest: null }))).latest?.tag ?? null;
    }
    const made = await ann()!.create({ repo: parsed.slug, tag, website, email, private: !!inst, installationId: inst?.installationId ?? null, ipHash });
    if (made) return c.json({ id: made.id, status: 'queued' }, 202);
    const existing = tag ? await ann()!.find({ repo: parsed.slug, tag, email }) : null;
    if (existing) return c.json({ id: existing.id, status: existing.status }, 200);
    return c.json({ error: 'That request could not be saved. Try again.' }, 500);
  });

  app.get('/announce/:id', async (c) => {
    const row = ann() ? await ann()!.get(c.req.param('id')) : null;
    if (!row) return c.json({ error: 'not found' }, 404);
    const { releaseBriefFrom, whyBelowTitle } = await import('@neuramesh/shared');
    const b = row.brief ? releaseBriefFrom('release-report.md', row.brief) : null;
    return c.json(announceView(row, b ? { title: b.title, verdict: b.verdict, why: whyBelowTitle(b) } : null));
  });

  app.get('/announce/:id/image', async (c) => {
    const img = ann() ? await ann()!.image(c.req.param('id')) : null;
    if (!img) return c.text('not found', 404);
    return new Response(Buffer.from(img.bytes), { headers: { 'content-type': img.mime, 'cache-control': 'public, max-age=86400' } });
  });

  // the GitHub App's grant: GitHub's own install page, then back here with the installation id
  app.get('/connect/github/start', (c) => {
    if (!githubAppConfigured()) return c.json({ error: 'the GitHub App is not configured on this server' }, 501);
    const parsed = parseRepoInput(c.req.query('repo') ?? '');
    return c.redirect(installUrl(parsed?.slug ?? ''), 302);
  });
  app.get('/connect/github/callback', async (c) => {
    const id = Number(c.req.query('installation_id'));
    const slug = parseRepoInput(c.req.query('state') ?? '')?.slug ?? '';
    if (!ann() || !githubAppConfigured() || !Number.isFinite(id) || id <= 0) return c.redirect(`${APP_URL}/announce?granted=0`, 302);
    try {
      const tok = await installationToken(id, { fetchFn });
      const repos = await githubGet('/installation/repositories?per_page=100', { token: tok.token, fetchFn });
      const names = repos.status === 200 ? ((repos.json as { repositories?: Array<{ full_name: string }> }).repositories ?? []).map((r) => r.full_name) : [];
      const acct = names[0]?.split('/')[0] ?? '';
      await ann()!.upsertInstallation({ installationId: id, account: acct, repos: names });
    } catch (e) {
      console.warn(`github app callback failed: ${e instanceof Error ? e.message : String(e)}`);
      return c.redirect(`${APP_URL}/announce?granted=0${slug ? `&repo=${encodeURIComponent(slug)}` : ''}`, 302);
    }
    return c.redirect(`${APP_URL}/announce?granted=1${slug ? `&repo=${encodeURIComponent(slug)}` : ''}`, 302);
  });

  // the cron: one row per tick, so a job's reads and its one model turn fit a function's time
  app.get('/internal/announce-due', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    if (!ann()) return c.json({ processed: 0, note: 'announcements not served by this store' });
    const mail: AnnounceDeps['mail'] = (row, email) => queueAndSend(store, { toEmail: row.email, template: 'announce-ready', kind: 'transactional', dedupeKey: `announce:${row.id}`, payload: { id: row.id, repo: row.repo, tag: row.tag } }, email, null);
    const deps: AnnounceDeps = { ...defaultDeps(mail), ...opts.deps };
    const rows = await ann()!.claimQueued(1);
    const results = [];
    for (const row of rows) results.push({ id: row.id, ...(await runAnnounceJob(ann()!, row, deps)) });
    return c.json({ processed: rows.length, results });
  });
}

/** POST /v1/announce/:id/claim — after the /v1 guard: the signed-in human saves the drafts into a workspace */
export function announceClaimRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.post('/v1/announce/:id/claim', async (c) => {
    const ann = store.announcements;
    if (!ann) return c.json({ error: 'announcements not served by this store' }, 501);
    const actor = c.get('actor');
    if (actor.kind !== 'human') return c.json({ error: 'a person claims a draft set', code: 'HUMAN_ONLY' }, 403);
    const body = z.object({ workspace: z.string().min(1) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body' }, 400);
    if (!(await actorInWorkspace(store, actor, body.data.workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const row = await ann.get(c.req.param('id'));
    if (!row) return c.json({ error: 'not found' }, 404);
    if (row.status !== 'ready') return c.json({ error: 'The drafts are not ready yet.' }, 409);
    if (row.claimedThreadId) return c.json({ threadId: row.claimedThreadId, workspace: row.claimedWorkspaceId, already: true });
    const out = await claimAnnouncement(store, ann, actor, body.data.workspace, row);
    return c.json({ ...out, workspace: body.data.workspace });
  });
}
