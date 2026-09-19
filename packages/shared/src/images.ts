// THE DRAW MARKER. The card's "Generate image" / "Try again" posts a message carrying
// ‹gen-image:itemId›, and the daemon draws that one draft from the brief already on it — no
// model turn, no LLM. It lives here rather than inline at each site because THREE places must
// agree on it exactly: the two wake paths that intercept it, and the wake GATE that decides
// whether this machine may serve the wake at all. They disagreed (2026-09-05): the gate asked
// "can this machine run claude-code?" of work that runs no model, so a cloud machine with no
// CLI refused every image the calendar asked it to draw, and the card sat on "still drawing".
const GEN_IMAGE_RE = /‹gen-image:([0-9a-f-]{8,})›/;

/** the draft this message asks to be drawn, or null when it asks for nothing */
export function genImageItemId(body: string): string | null {
  return GEN_IMAGE_RE.exec(body)?.[1] ?? null;
}

// THE FILM MARKER (2026-09-18, George: "a generate video button similar to the generate image
// that generates the actual video"). The card's "Generate video" posts ‹gen-video:itemId› and the
// daemon films that one draft from the script and the brief already on it — no model turn. The
// same three sites agree on it as on the draw marker: both wake paths and the wake gate.
const GEN_VIDEO_RE = /‹gen-video:([0-9a-f-]{8,})›/;
export function genVideoItemId(body: string): string | null {
  return GEN_VIDEO_RE.exec(body)?.[1] ?? null;
}
/** a message that asks for a draw or a film runs no model: the wake gate must not ask for a runtime */
export function modelFreeItemId(body: string): string | null {
  return genImageItemId(body) ?? genVideoItemId(body);
}

/** The video type the BYTES say they are: an ISO base media file (`ftyp` at byte 4) is mp4, an
 *  EBML head is webm. null when they say nothing we recognize. */
export function sniffVideoMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'video/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';
  return null;
}

// Image mime TRUTH (2026-08-20). A generated image's declared type is a guess three times
// over — the model's default output format, a hardcoded 'image/png' at decode, a content-type
// header echoing the stored guess — and X's media finalize sniffs the actual bytes, so the
// first lie surfaces as "media type unrecognized" at the very end of the pipeline. Magic
// numbers are the one honest answer; every layer that records or declares a type consults
// them and treats the declaration as the fallback, never the authority.

/** The image type the BYTES say they are, or null when they say nothing we recognize. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return null;
}
