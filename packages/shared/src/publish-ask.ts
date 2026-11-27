// THE PUBLISH ASK (docs/design/inbox-sales-2026-11/plan.md I14 point 4): an agent asks to publish a file with
// `ask_publish`, which posts the marker `‹publish:<fileId>|<for>›`. hq draws it as the publish card, and only a
// person selects Publish there. The `for` part is the agent's line on what the link is for, shown on the card.
// `‹published:<fileId>|<for>›` is the same card after an agent published the file on the person's request
// (George, 2026-11-24): the API posts it, and the card shows the link and Remove link.

export interface PublishAsk {
  /** the file (an artifacts row) the agent asks to publish */
  id: string;
  /** what the link is for, in the agent's words, or '' */
  for: string;
  /** the message text around the marker: prose stays prose, the marker becomes the card */
  prose: string;
  /** an agent published the file already (the API's message), so the card opens on the link */
  done: boolean;
}

const MARKER = /‹publish(ed)?:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\|([^‹›]{0,200}))?›/i;

/** the first publish ask in a message, or null */
export function parsePublishAsk(body: string): PublishAsk | null {
  const m = MARKER.exec(body);
  if (!m) return null;
  return { id: m[2]!.toLowerCase(), for: (m[3] ?? '').trim(), prose: body.replace(new RegExp(MARKER.source, 'gi'), '').trim(), done: !!m[1] };
}

const marker = (word: string, id: string, purpose: string): string => {
  const line = purpose.replace(/[‹›|\n\r]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `‹${word}:${id}${line ? `|${line}` : ''}›`;
};

/** the marker for a file, with the `for` line cut to fit and cleared of the marker's own brackets */
export const publishAskMarker = (id: string, purpose = ''): string => marker('publish', id, purpose);

/** the marker of the API's message after an agent publish */
export const publishedMarker = (id: string, purpose = ''): string => marker('published', id, purpose);

const MEDIA_NAME = /\.(mp4|webm|png|jpe?g|webp|gif)$/i;
const PAGE_NAME = /\.html?$/i;

/** a file that can go out (I14 point 5, I15): a video, an image or GIF up to 200 MB, a page up to 5 MB. The server
 *  decides by the bytes. This reads the name and the size, so a door never shows for a file that cannot work */
export function publishableName(name: string, sizeBytes?: number | null): boolean {
  const size = sizeBytes ?? 0;
  if (MEDIA_NAME.test(name)) return size <= 200 * 1024 * 1024;
  return PAGE_NAME.test(name) && size <= 5 * 1024 * 1024;
}
