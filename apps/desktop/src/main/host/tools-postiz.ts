// THE POSTIZ READS (docs/design/postiz-connector-2026-11, P11): an agent reads the room's project's Postiz account,
// and only reads. Each tool is one GET on /v1/postiz/read/*, which the API serves only to an agent of the room and
// only as Postiz reads, so no tool here can write to Postiz. A post goes out through Postiz only when a person
// approves a draft (draft_posts with postizChannel, then the card). Hosted only: a NeuraMesh with no Postiz
// answers 404, and the tool says so.
import type { LogFn } from '../agentlog';
import type { OrchTool } from './orchtools';

export interface PostizToolCtx {
  z: typeof import('zod')['z'];
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<Response>;
  ch: { id: string };
  actor: { kind: string; id: string; role?: string };
  log?: LogFn;
}

export function postizTools(t: PostizToolCtx): OrchTool[] {
  const { z, log } = t;
  const read = async (what: string, params: Record<string, string | undefined>): Promise<string> => {
    log?.({ kind: 'tool', phase: 'call', summary: `postiz_${what}` });
    const q = new URLSearchParams({ channel: t.ch.id });
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    const res = await t.apiGet(`/v1/postiz/read/${what}?${q}`, t.actor).catch(() => null);
    if (!res) return 'The NeuraMesh API did not answer. Try again.';
    if (res.status === 404) return 'This NeuraMesh has no Postiz. Postiz works on the hosted NeuraMesh, when a person connects it in Connections.';
    const body = await res.text();
    if (!res.ok) { try { return (JSON.parse(body) as { error?: string }).error ?? body; } catch { return body.slice(0, 500); } }
    return body.slice(0, 20_000);
  };
  const channel = z.string().min(1).max(128).describe('a channel id from postiz_channels');
  return [
    { name: 'postiz_channels', description: 'List the channels of this project\'s Postiz account: id, network, name, and whether Postiz turned it off.', schema: {},
      run: async () => read('channels', {}) },
    { name: 'postiz_posts', description: 'List this project\'s Postiz posts between two times (62 days at most), posts made in Postiz too.', schema: {
      from: z.string().max(40).optional().describe('ISO time (default: a day ago)'),
      to: z.string().max(40).optional().describe('ISO time (default: in 14 days)'),
    }, run: async (i: { from?: string; to?: string }) => read('posts', { from: i.from, to: i.to }) },
    { name: 'postiz_channel_rules', description: 'Read a Postiz channel\'s rules, length limit and settings schema. Read it before you draft for that channel.', schema: { integration: channel },
      run: async (i: { integration: string }) => read('rules', { integration: i.integration }) },
    { name: 'postiz_analytics', description: 'Read the numbers of a Postiz channel or post for the last 7, 30 or 90 days.', schema: {
      integration: channel.optional(),
      post: z.string().min(1).max(128).optional().describe('a post id from postiz_posts'),
      days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
    }, run: async (i: { integration?: string; post?: string; days?: number }) => read('analytics', { integration: i.integration, post: i.post, days: String(i.days ?? 7) }) },
    { name: 'postiz_media', description: 'Find files in this project\'s Postiz media library by name.', schema: {
      search: z.string().max(100).optional(),
    }, run: async (i: { search?: string }) => read('media', { search: i.search }) },
  ];
}
