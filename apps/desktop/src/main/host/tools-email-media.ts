// THE AGENT ADDS WHAT AN EMAIL NEEDS (docs/design/inbox-sales-2026-11/plan.md I13): an image or a GIF from the room's
// Files, a picture it draws from a brief, or a video link. The tool writes a REFERENCE into the email's body (an asset
// block, shared/email-body.ts) and never bytes: the API reads the file from Files at Send, so the room's ACL holds. A
// picture the agent draws goes to the room's Files first, through the session's artifact upload, and then the block
// names it. The rules of the email-media skill ride the description: alt text on each image, a GIF under 2 MB and
// 600 px wide, a video always as a poster with a link, and a public link only with the person's approval.
import { createHash, randomUUID } from 'node:crypto';
import { EMAIL_ASSET_CAP, bodyRefusal, emailAssets, emailBlocks, emailBodyOf, insertAsset, safeLink, type EmailAsset, type EmailDraftRow } from '@neuramesh/shared';
import type { EmailToolCtx } from './tools-email';
import { emailByLetter, revisionGate } from './tools-email';
import type { OrchTool } from './orchtools';

const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;
const VIDEO_NAME = /\.(mp4|webm|mov|m4v)$/i;

export function emailMediaTools(tc: EmailToolCtx): OrchTool[] {
  const { z, db, post, ch, actor, convoThreadId, log } = tc;
  const errorOf = async (res: Response | null) => ((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? 'the server did not answer';
  return [{
    name: 'add_email_media',
    description: `Put an image, a GIF or a video into an email ALREADY on the card here, by letter: a file from this room's Files (its name, as list_library shows it), a picture you draw from a brief, or a video link (YouTube, Loom, Vimeo or a published link). Images and GIFs send inline. A video always sends as its poster with a link, because email apps do not play video: for a video file, ask_publish it first, or ask the person for a link. Rules: alt text on each one (what the picture shows, for a person who cannot see it); a GIF under 2 MB and at most 600 px wide; at most ${EMAIL_ASSET_CAP} in one email and 20 MB in all; never make a file public without the person's approval. Give \`version\`, the version of the email you read.`,
    schema: {
      letter: z.string().min(1).max(2).describe('the email letter on the card: a, b, c'),
      version: z.number().int().min(1).optional().describe('the version you read and change'),
      file: z.string().max(512).optional().describe('the name of an image or GIF in this room\'s Files'),
      brief: z.string().max(1500).optional().describe('art direction for a picture you draw: subject, composition, light, mood'),
      video: z.string().max(2000).optional().describe('an https link to the video page'),
      alt: z.string().min(1).max(200).describe('alt text: what the picture shows, in one short line'),
      after: z.string().max(200).optional().describe('the start of the paragraph to place it after. With none, it goes before the sign-off'),
    },
    run: async (input: { letter: string; version?: number; file?: string; brief?: string; video?: string; alt: string; after?: string }) => {
      if (!convoThreadId) return 'Email drafts live in a conversation. Reply in the conversation.';
      if ([input.file, input.brief, input.video].filter(Boolean).length !== 1) return 'Name exactly one: a file, a brief or a video link.';
      const rows = await db.getAll<EmailDraftRow>('select * from email_drafts where thread_id = ? order by created_at', [convoThreadId]).catch(() => [] as EmailDraftRow[]);
      const row = emailByLetter(rows, input.letter);
      if (!row) return `No waiting email ${input.letter} is on a card here. Sent and replaced emails do not change.`;
      const gate = revisionGate(row, input.version);
      if (gate) return gate;
      if (emailAssets(row.body).length >= EMAIL_ASSET_CAP) return `Email ${row.letter} holds ${EMAIL_ASSET_CAP} assets already. Remove one first with revise_emails.`;
      let asset: EmailAsset;
      if (input.video) {
        const url = safeLink(input.video);
        if (!url) return 'The video link must be an https address of the video page.';
        asset = { alt: input.alt, video: url };
      } else if (input.file) {
        const found = await db.getAll<{ id: string; name: string }>('select id, name from artifacts where channel_id = ? and lower(name) = lower(?) order by created_at desc limit 1', [ch.id, input.file.trim()])
          .catch(() => [] as Array<{ id: string; name: string }>);
        const f = found[0];
        if (!f) return `No file named "${input.file}" is in this room's Files. Call list_library for the names.`;
        if (VIDEO_NAME.test(f.name)) return `"${f.name}" is a video. Email apps do not play a video: ask_publish it, or ask the person for a link, then add the link with \`video\`.`;
        if (!IMAGE_NAME.test(f.name)) return `"${f.name}" is not an image. An email holds PNG, JPEG, GIF or WebP images.`;
        asset = { alt: input.alt, file: f.id };
      } else {
        if (!tc.draw) return 'You cannot draw here. Add a file from Files, or a video link.';
        const drawn = await tc.draw(input.brief!).catch((e: unknown) => ({ error: e instanceof Error ? e.message : 'the drawing failed' }));
        if (!('bytes' in drawn) || !drawn.bytes || !drawn.mime) return `The picture was not drawn: ${'error' in drawn ? drawn.error : 'no image'}. Say so plainly.`;
        // the picture goes to the room's Files first, in this session, and the email names it there
        const id = randomUUID();
        const name = `${input.alt.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'image'}.${drawn.mime.split('/')[1] === 'jpeg' ? 'jpg' : drawn.mime.split('/')[1]}`;
        const saved = await post('/v1/brain/artifacts', actor, {
          id, workspace: ch.workspace_id, channel: ch.id, threadId: convoThreadId, kind: 'file', name, mime: drawn.mime,
          contentBase64: drawn.bytes.toString('base64'), sha256: createHash('sha256').update(drawn.bytes).digest('hex'),
        }).catch(() => null);
        if (!saved?.ok) return `The picture was drawn but did not save to Files: ${await errorOf(saved)}. Say so plainly.`;
        asset = { alt: input.alt, file: id };
      }
      const blocks = emailBlocks(row.body);
      const want = input.after?.trim().toLowerCase();
      const at = want ? blocks.findIndex((b) => b.kind === 'text' && b.text.trim().toLowerCase().startsWith(want)) : -1;
      if (want && at < 0) return `No paragraph of email ${row.letter} starts with "${input.after}". Name the start of a paragraph, or leave \`after\` out.`;
      const body = emailBodyOf(insertAsset(blocks, asset, want ? at : undefined));
      const no = bodyRefusal(body);
      if (no) return no;
      const res = await post('/v1/commands', actor, { type: 'email.revise', email: row.id, version: row.version, body }).catch(() => null);
      if (!res?.ok) return `Email ${row.letter} did not change: ${await errorOf(res)}`;
      log?.({ kind: 'tool', phase: 'call', summary: `add_email_media — ${row.letter}` });
      return `Email ${row.letter} has the ${'video' in asset ? 'video link' : 'picture'} now (v${row.version + 1}). Nothing is sent. Say it in one short line.`;
    },
  }];
}
