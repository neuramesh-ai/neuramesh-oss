// The film lane for a UGC draft (George, 2026-09-18: "a generate video button similar to the
// generate image that generates the actual video"). The card's "Generate video" posts
// ‹gen-video:itemId›; this films THAT draft from the script and the brief already on it, with the
// workspace's own Google key (the Gemini API, the BYOK shape every runtime uses), and attaches the
// bytes to the draft the way a picture attaches. No model turn, no LLM: the prompt is built from
// the script's first beat by code, and the outcome lands ON the card (the film, or the reason it
// did not come). A clip is eight seconds, so the film is the HOOK, and the card says so.
//
// WHICH PROVIDERS (researched 2026-09-18, docs/design/marketing-os-2026-08/plan.md §17.2): a Google
// key is the one connection that reaches a video model today. Gemini Omni Flash is Google's own
// default ("use it as your default model for video generation"), first on the text-to-video
// leaderboard with native dialogue, 9:16, 3 to 10 s, about $0.10 per second at 720p; Veo 3.1 is the
// second rung for a key that cannot see it. OpenAI's Videos API and Sora 2 shut down on
// 2026-09-24 with no successor, and Anthropic has no video model, so neither seat can film. The
// next options (ByteDance Seedance 2.0, Kling 3.0, MiniMax H3) each need their own key, which
// NeuraMesh does not hold yet: a rung here is one entry once such a connection exists.
import { sniffVideoMime } from '@neuramesh/shared';
import { designerImageCred, type HostedAgent } from '../agents';
import type { PowerSyncDatabase } from '@powersync/node';

/** the Google ladder, best first; a key that cannot see a rung falls to the next (never on a refusal).
 *  `omni` films through the Interactions API in one call; `veo` starts a long-running operation. */
export const VIDEO_MODELS = [
  { id: 'gemini-omni-1.1-flash', kind: 'omni' },
  { id: 'veo-3.1-fast-generate-preview', kind: 'veo' },
  { id: 'veo-3.1-generate-preview', kind: 'veo' },
] as const;
const POLL_MS = 8_000;
const FILM_TIMEOUT_MS = 8 * 60_000;
const FILM_MAX_BYTES = 8_000_000; // the attach lane's ceiling (Instagram's own)
const unavailable = (status: number, msg: string): boolean =>
  status === 404 || ((status === 400 || status === 403) && /model|not found|does not exist|do not have access|not available|unsupported/i.test(msg));

export interface FilmBeat { direction: string; spoken: string; caption: string }

/** The timestamp line's remainder. A house model writes the whole beat ON that line
 *  (`[0:00-0:05] Hook: "Stop letting agents edit main." CAPTION: The chat loop is broken.`, live
 *  2026-09-19), so the caption and the spoken line are read off it by name, a quoted remainder is
 *  the creator's line, the `Hook:` label is dropped, and what is left is the direction. Read as
 *  one line, that beat put the caption's words in the prompt beside "render no text". */
function stampLine(rest: string, beat: FilmBeat): void {
  let s = rest;
  const cap = /\bCAPTION(?:\s+ON\s+SCREEN)?\s*:\s*(.*)$/i.exec(s);
  if (cap) { beat.caption = cap[1]!.trim(); s = s.slice(0, cap.index); }
  const spoken = /\bSpoken\s*:\s*(.*)$/i.exec(s);
  if (spoken) { beat.spoken = spoken[1]!.replace(/^["“]|["”]$/g, '').trim(); s = s.slice(0, spoken.index); }
  s = s.replace(/^(?:the\s+)?hook\s*[:—–-]?\s*/i, '').trim();
  const quoted = /^["“](.+)["”]\s*$/.exec(s);
  if (quoted) { if (!beat.spoken) beat.spoken = quoted[1]!.trim(); s = ''; }
  beat.direction = s.replace(/\.\s*$/, '').trim();
}

/** The script's first beat: the `[0:00-0:03]` block a UGC script opens with. Direction is the
 *  rest of the timestamp line, `Spoken:` and `CAPTION` lines are read by name. A body without
 *  timestamps is one beat: its first three lines. */
export function firstBeat(body: string): FilmBeat {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const start = lines.findIndex((l) => /^\[\d+:\d\d\s*[-–]\s*\d+:\d\d\]/.test(l));
  const block = start >= 0 ? lines.slice(start, lines.findIndex((l, i) => i > start && /^\[\d+:\d\d/.test(l)) > 0 ? lines.findIndex((l, i) => i > start && /^\[\d+:\d\d/.test(l)) : undefined) : lines.slice(0, 3);
  const beat: FilmBeat = { direction: '', spoken: '', caption: '' };
  for (const l of block) {
    const stamp = /^\[[^\]]+\]\s*(.*)$/.exec(l);
    if (stamp) { stampLine(stamp[1]!, beat); continue; }
    const spoken = /^spoken\s*:\s*(.*)$/i.exec(l);
    if (spoken) { beat.spoken = spoken[1]!.replace(/^["“]|["”]$/g, '').trim(); continue; }
    // a bare quoted line is a spoken line too (a script written as the creator's lines, no labels)
    const quoted = /^["“](.+)["”]\s*$/.exec(l);
    if (quoted) { if (!beat.spoken) beat.spoken = quoted[1]!.trim(); continue; }
    const cap = /^caption(?:\s+on\s+screen)?\s*:\s*(.*)$/i.exec(l);
    if (cap) { beat.caption = cap[1]!.trim(); continue; }
    if (!beat.direction) beat.direction = l;
  }
  return beat;
}

/** The prompt Veo films: a vertical phone clip of the hook, the creator's line, the caption, the
 *  brief's visual direction. Under a thousand characters, nothing invented beyond the script. */
export function filmPrompt(body: string, brief: string): string {
  const b = firstBeat(body);
  const parts = [
    'A vertical 9:16 short-form video, 8 seconds, filmed on a phone like a creator would: handheld, natural light, no studio.',
    b.direction ? `Opening shot: ${b.direction}.` : '',
    b.spoken ? `The creator says to camera, casually: "${b.spoken}"` : '',
    // never ask the model to RENDER the caption: the live film spelled "no lapop, still shoping". The
    // caption is burned in at publish time; the film keeps the bottom third clear for it.
    b.caption ? 'Leave the bottom third of the frame clear for a caption. Render no text, no subtitles, no lettering.' : 'Render no text, no subtitles, no lettering.',
    brief ? `Visual direction: ${brief}` : '',
    'Keep it raw and real. No logos or brand text beyond what the app shows on screen.',
  ].filter(Boolean);
  return parts.join(' ').slice(0, 1_400);
}

type Fetch = typeof fetch;
const BASE = 'https://generativelanguage.googleapis.com/v1beta';

type Op = {
  done?: boolean; error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }>; raiMediaFilteredCount?: number; raiMediaFilteredReasons?: string[] }; generatedVideos?: Array<{ video?: { uri?: string } }> };
};
type Clock = { fetchFn: Fetch; sleep: (ms: number) => Promise<void>; now: () => number };
type Film = { bytes?: Buffer; mime?: string; model?: string; error?: string };

/** the clip's address once the operation is done, or why there is none */
function clipUri(op: Op): { uri?: string; error?: string } {
  if (op.error) return { error: op.error.message ?? 'the film failed' };
  const r = op.response ?? {};
  const uri = r.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? r.generatedVideos?.[0]?.video?.uri;
  if (uri) return { uri };
  const why = r.generateVideoResponse?.raiMediaFilteredReasons?.[0];
  return { error: why ? `the model declined the prompt: ${why}` : 'the film came back empty' };
}

/** poll the operation until it is done, then download the clip */
async function awaitClip(key: string, name: string, c: Clock): Promise<Film> {
  const deadline = c.now() + FILM_TIMEOUT_MS;
  for (;;) {
    await c.sleep(POLL_MS);
    if (c.now() > deadline) return { error: 'the film took longer than eight minutes' };
    const poll = await c.fetchFn(`${BASE}/${name}`, { headers: { 'x-goog-api-key': key } });
    const op = (await poll.json().catch(() => null)) as Op | null;
    if (!poll.ok) return { error: op?.error?.message ?? `veo poll ${poll.status}` };
    if (!op?.done) continue;
    const clip = clipUri(op);
    if (!clip.uri) return { error: clip.error };
    return download(key, clip.uri, c);
  }
}

/** the clip's bytes, sized and sniffed, or why not */
function clipBytes(bytes: Buffer): Film {
  if (!bytes.length) return { error: 'the film downloaded empty' };
  if (bytes.length > FILM_MAX_BYTES) return { error: `the film is too large to attach (${Math.round(bytes.length / 1e6)} MB, max 8 MB)` };
  return { bytes, mime: sniffVideoMime(new Uint8Array(bytes.subarray(0, 16))) ?? 'video/mp4' };
}

// the live API answers with `steps` (a thought, then a model_output); the docs' example says
// `outputs`. Both are read (found live, 2026-09-19: "the film came back empty" on a 1.3 MB clip).
type Part = { type?: string; mime_type?: string; data?: string; uri?: string };
type Interaction = { id?: string; status?: string; error?: { message?: string }; steps?: Array<{ type?: string; content?: Part[] }>; outputs?: Array<{ type?: string; content?: Part[] }> };

/** Gemini Omni Flash: one synchronous call to the Interactions API, the clip inline as base64 (or
 *  at a URI the key downloads). `started` is the create response, already read. */
async function omniClip(key: string, started: Interaction, c: Clock): Promise<Film> {
  let it = started;
  const deadline = c.now() + FILM_TIMEOUT_MS;
  // a call that came back before it finished (background delivery): poll the interaction
  while (it.status && it.status !== 'completed' && it.status !== 'failed' && it.id) {
    await c.sleep(POLL_MS);
    if (c.now() > deadline) return { error: 'the film took longer than eight minutes' };
    const poll = await c.fetchFn(`${BASE}/interactions/${it.id}`, { headers: { 'x-goog-api-key': key } });
    it = ((await poll.json().catch(() => null)) as Interaction | null) ?? {};
    if (!poll.ok) return { error: it.error?.message ?? `omni poll ${poll.status}` };
  }
  if (it.error || it.status === 'failed') return { error: it.error?.message ?? 'the film failed' };
  const video = [...(it.steps ?? []), ...(it.outputs ?? [])].flatMap((o) => o.content ?? []).find((part) => part.type === 'video');
  if (video?.data) return clipBytes(Buffer.from(video.data, 'base64'));
  if (video?.uri) return download(key, video.uri, c);
  return { error: 'the model declined the prompt: the film came back empty' };
}

/** the clip at a Google-hosted uri, fetched with the key */
async function download(key: string, uri: string, c: Clock): Promise<Film> {
  const dl = await c.fetchFn(uri, { headers: { 'x-goog-api-key': key }, redirect: 'follow' });
  if (!dl.ok) return { error: `the film could not be downloaded (${dl.status})` };
  return clipBytes(Buffer.from(await dl.arrayBuffer()));
}

/** the start call for one rung: Omni's Interactions create, or Veo's long-running predict */
function startCall(model: (typeof VIDEO_MODELS)[number], prompt: string): { url: string; body: unknown } {
  if (model.kind === 'omni') {
    // one unary call (background/store/stream off is Google's own "fastest, synchronous" shape);
    // no duration parameter exists, the prompt names the eight seconds
    return { url: `${BASE}/interactions`, body: { model: model.id, input: prompt, response_format: { type: 'video', aspect_ratio: '9:16', resolution: '720p' }, background: false, store: false, stream: false } };
  }
  // no personGeneration: Veo 3.1 refused 'allow_adult' on text-to-video ("currently not supported",
  // live, 2026-09-18) and the model's own default films people
  return { url: `${BASE}/models/${model.id}:predictLongRunning`, body: { instances: [{ prompt }], parameters: { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p' } } };
}

/** One film on Google: the first model the key reaches, Omni in one call or Veo polled, the clip downloaded. */
export async function veoFilm(key: string, prompt: string, opts: Partial<Clock> = {}): Promise<Film> {
  const c: Clock = { fetchFn: opts.fetchFn ?? fetch, sleep: opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))), now: opts.now ?? Date.now };
  for (const model of VIDEO_MODELS) {
    const call = startCall(model, prompt);
    const start = await c.fetchFn(call.url, {
      method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(call.body), signal: AbortSignal.timeout(FILM_TIMEOUT_MS),
    }).catch((e: unknown) => new Response(JSON.stringify({ error: { message: e instanceof Error && e.name === 'TimeoutError' ? 'the film took longer than eight minutes' : String(e) } }), { status: 599 }));
    const started = (await start.json().catch(() => null)) as (Interaction & { name?: string }) | null;
    if (start.ok && model.kind === 'omni' && started) return { ...(await omniClip(key, started, c)), model: model.id };
    if (start.ok && model.kind === 'veo' && started?.name) return { ...(await awaitClip(key, started.name, c)), model: model.id };
    const msg = started?.error?.message ?? `${model.kind} ${start.status}`;
    if (!unavailable(start.status, msg)) return { error: msg };
    // else: this key cannot reach that rung, try the next
  }
  return { error: 'this key reaches no video model. Video needs a Google AI key that can use Gemini Omni Flash or Veo' };
}

/** The platform's answer to a film ask (POST /v1/starter/film): filming, or why the rung falls to the person's own key. */
export type DoorAnswer = { filming: true; tier: string; model: string; credits: number } | { filming: false; code: 'NO_CREDITS' | 'UNAVAILABLE' | 'UPSTREAM' | 'IN_FLIGHT' | 'OTHER'; error: string; credits?: number };

/** ask the door once; the server owns the film from a 202 on */
export async function askDoor(post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>, actor: { kind: string; id: string; role?: string }, body: { workspace: string; item: string; prompt: string }): Promise<DoorAnswer> {
  const r = await post('/v1/starter/film', actor, body).catch(() => null);
  if (!r) return { filming: false, code: 'OTHER', error: 'the server did not answer' };
  const j = (await r.json().catch(() => ({}))) as { code?: string; error?: string; credits?: number; tier?: { label?: string; model?: string } };
  if (r.status === 202) return { filming: true, tier: j.tier?.label ?? 'NeuraMesh Video', model: j.tier?.model ?? '', credits: j.credits ?? 0 };
  const code = j.code === 'NO_CREDITS' || j.code === 'UNAVAILABLE' || j.code === 'UPSTREAM' || j.code === 'IN_FLIGHT' ? j.code : 'OTHER';
  return { filming: false, code, error: j.error ?? `the door answered ${r.status}`, ...(j.credits ? { credits: j.credits } : {}) };
}

/** the script beside the caption (media.script); an older draft carried it as the body */
function scriptOf(d: { body: string; media: string | null }): { script: string; brief: string } {
  try {
    const m = JSON.parse(d.media ?? 'null') as { brief?: string; script?: string } | null;
    return { script: m?.script || d.body, brief: m?.brief ?? '' };
  } catch { return { script: d.body, brief: '' }; }
}

/** why a draft has no film when the platform said no and the workspace holds no Google key */
function noKeyReason(answer: Exclude<DoorAnswer, { filming: true }>, provider: string | undefined): string {
  if (answer.code === 'NO_CREDITS') return `out of credits. A film costs about ${answer.credits ?? 'a few hundred'} credits. Add credits, or add a Google AI key under Image generation and the film runs on your key`;
  if (provider === 'openai') return 'this workspace has an OpenAI key only. Video needs a Google AI key under Image generation: OpenAI closed its video API on 2026-09-24';
  return 'video is not set up here. Add a Google AI key under Image generation to film on your own key';
}

/** The draft-scoped lane the wake calls: read the draft, ask the platform's door first (a film on
 *  credits, the server owns it from a 202), fall to the workspace's own Google key when the door
 *  says no credits or no lane, and explain on the card otherwise. */
export function makeFilm(ctx: {
  db: PowerSyncDatabase;
  apiUrl: string;
  ownerActorId: string;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  agents: Map<string, HostedAgent>;
  film?: typeof veoFilm;
  door?: typeof askDoor;
}) {
  const { db, apiUrl, ownerActorId, post, agents } = ctx;
  const film = ctx.film ?? veoFilm;
  const door = ctx.door ?? askDoor;
  async function filmDraft(agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string): Promise<string> {
    const [d] = await db.getAll<{ body: string; media: string | null }>(
      `select body, media from content_items where id = ? and channel_id = ? and status = 'draft'`,
      [itemId, ch.id],
    ).catch(() => [] as Array<{ body: string; media: string | null }>);
    if (!d) return `That draft is not available to film (already scheduled or gone).`;
    const { script, brief } = scriptOf(d);
    const postCmd = async (cmd: unknown): Promise<boolean> => {
      const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
      return !!(r && (r as { ok?: boolean }).ok);
    };
    const prompt = filmPrompt(script, brief);
    // THE PLATFORM FIRST (the video rung, issue #539): a film on credits, the model the server's env
    // names for the workspace's tier. A 202 means the server films and lands it on the card itself;
    // no credits or no lane sends the rung down to the person's own Google key, exactly the lane
    // that shipped in 0.137.0. Any other answer is the card's to show.
    const actor = { kind: 'agent', id: agent.id, role: agent.role };
    const answer = await door(post, actor, { workspace: ch.workspace_id, item: itemId, prompt });
    if (answer.filming) {
      console.log(`agent_gen_video agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} filming on ${answer.model} credits=${answer.credits}`);
      return `Filming the hook on ${answer.tier} (${answer.model}). It takes about two minutes and costs ${answer.credits} credits. The film lands on the card.`;
    }
    if (answer.code === 'UPSTREAM' || answer.code === 'IN_FLIGHT' || answer.code === 'OTHER') {
      const why = answer.error.replace(/\.$/, '');
      await postCmd({ type: 'content.revise', item: itemId, videoError: why });
      return `The film did not start: ${why}. The reason is on the card.`;
    }
    // the workspace's Google key: the designer's seat when it is Gemini, else the image ladder's
    // Gemini rung, else the machine's own env. Only a Google key reaches a video model (see the
    // head of this file), so an OpenAI-only workspace is told what to add, not that nothing exists.
    const designer = [...agents.values()].find((a) => a.role === 'designer' && a.channels.has(ch.id));
    const { cred } = await designerImageCred(apiUrl, ch.workspace_id, designer, ownerActorId);
    const key = cred?.provider === 'gemini' ? cred.key : (process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY'] || null);
    if (!key) {
      const why = noKeyReason(answer, cred?.provider);
      await postCmd({ type: 'content.revise', item: itemId, videoError: why, videoErrorCode: answer.code });
      return `I cannot film it: ${why}.`;
    }
    const out = await film(key, prompt);
    if (!out.bytes) {
      const why = (out.error ?? 'the film came back empty').replace(/\.$/, '');
      await postCmd({ type: 'content.revise', item: itemId, videoError: why });
      console.log(`agent_gen_video agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} failed=${why}`);
      return `The film did not come: ${why}. The reason is on the card. Press Try again when it is sorted.`;
    }
    const ok = await postCmd({ type: 'content.attach_media', item: itemId, dataUrl: `data:${out.mime};base64,${out.bytes.toString('base64')}` });
    if (!ok) {
      await postCmd({ type: 'content.revise', item: itemId, videoError: 'the film did not attach to the draft' });
      return `The film came back but did not attach to the draft. Try again.`;
    }
    // the film's facts on the card: the person's own key, no credits
    await postCmd({ type: 'content.revise', item: itemId, videoMeta: { tier: 'own', model: out.model ?? 'google', seconds: 8, credits: 0, at: new Date().toISOString() } });
    console.log(`agent_gen_video agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} ok model=${out.model ?? '?'} bytes=${out.bytes.length}`);
    return `Filmed the hook${out.model ? ` on ${out.model}` : ''} with your Google key. An eight-second cut is on the card. Nothing publishes until you approve.`;
  }
  return { filmDraft };
}
