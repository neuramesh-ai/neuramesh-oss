// A PICTURE FROM THE PHONE, attached to the message you are about to send.
//
// The row is an `artifacts` row carrying `message_id`, which is exactly what the desktop's
// insertAttachments writes — the ps_crud artifacts branch is gated on that column, so a chat
// attachment uploads and a channel-scoped one would be dropped. Same table, same columns, same
// thread query renders both.
//
// The bytes ride in `inline_content` as a data: URI, because that is what the thread already reads
// (thread.tsx renders `a.inline_content` straight into an <Image source>). A phone has no blob
// store of its own to point at.
import { randomUUID } from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { getDb } from './system';

/** THE SERVER'S OWN NUMBER. `/v1/artifacts` validates `inlineContent` at `z.string().max(400_000)`,
 *  so anything longer comes back "invalid artifact" — which is exactly what the first photo did.
 *  The cap is the whole data: URI, prefix included, because that is the string the server measures. */
export const MAX_INLINE_CHARS = 400_000;

/** what a photo is shrunk to before it becomes a row. The thread renders a thumbnail and an agent
 *  reads a description, so full resolution buys nothing and costs the ordered upload queue that
 *  every later message waits behind. The desktop stores a THUMB inline for the same reason and
 *  keeps the real bytes on disk; a phone has no such disk, so the thumb is the whole picture. */
export const MAX_EDGE = 1400;

/** the glyph a row shows for a file the phone cannot draw. Names, not guesses: the extension is
 *  what a person recognises, and a mime we have never seen must still land somewhere honest. */
export function fileKindOf(name: string, mime: string | null | undefined): 'image' | 'pdf' | 'doc' | 'sheet' | 'code' | 'archive' | 'file' {
  const m = (mime ?? '').toLowerCase();
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (['doc', 'docx', 'rtf', 'pages', 'txt', 'md'].includes(ext) || m.startsWith('text/')) return 'doc';
  if (['csv', 'xls', 'xlsx', 'numbers', 'tsv'].includes(ext)) return 'sheet';
  if (['json', 'ts', 'tsx', 'js', 'py', 'go', 'rs', 'sql', 'sh', 'yml', 'yaml', 'html', 'css'].includes(ext)) return 'code';
  if (['zip', 'gz', 'tar', 'rar', '7z'].includes(ext)) return 'archive';
  return 'file';
}

export interface PickedPhoto {
  /** the data: URI the thread renders directly */
  uri: string;
  name: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/** the library picker, already downscaled. Null when the person backed out; a thrown Error carries
 *  a sentence worth showing (a refused permission, a photo too big to sync). */
export async function pickPhoto(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('NeuraMesh needs access to your photos. Turn it on in Settings.');
  // base64 is NOT asked for here: the picker would hand back the full-resolution encoding and the
  // resize below throws it away. Ask once, after shrinking.
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0]!;

  const wide = (a.width ?? 0) >= (a.height ?? 0);
  const shrunk = await ImageManipulator.manipulateAsync(
    a.uri,
    (a.width ?? 0) > MAX_EDGE || (a.height ?? 0) > MAX_EDGE
      ? [{ resize: wide ? { width: MAX_EDGE } : { height: MAX_EDGE } }]
      : [],
    { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!shrunk.base64) throw new Error('That picture could not be read. Try another one.');

  const uri = `data:image/jpeg;base64,${shrunk.base64}`;
  // measured, never estimated: the server counts the characters of this exact string
  if (uri.length > MAX_INLINE_CHARS) throw new Error('That picture is too large to send. Try a smaller one.');
  return {
    uri,
    name: a.fileName ?? `photo-${new Date().toISOString().slice(0, 10)}.jpg`,
    // the resize re-encodes, so the row must say JPEG whatever the original was
    mime: 'image/jpeg',
    bytes: Math.ceil((shrunk.base64.length * 3) / 4),
    width: shrunk.width ?? null,
    height: shrunk.height ?? null,
  };
}

/** ANY FILE, not only a picture (George, 2026-09-07: "attachments shouldn't just be photo, could
 *  be files, pdf etc"). It rides the same artifacts row a photo does, so nothing downstream has to
 *  learn a second shape — only the `kind` and the bytes differ.
 *
 *  The same 400,000-character ceiling applies, and for a file there is nothing to downscale: a PDF
 *  is the size it is. So this refuses in a sentence rather than queueing a write the server will
 *  reject, which is the difference between "too large to send" and a photo that vanishes. */
export async function pickFile(): Promise<PickedPhoto | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
  if (res.canceled || !res.assets?.length) return null;
  const a = res.assets[0]!;
  const mime = a.mimeType ?? 'application/octet-stream';
  const b64 = await FileSystem.readAsStringAsync(a.uri, { encoding: FileSystem.EncodingType.Base64 });
  const uri = `data:${mime};base64,${b64}`;
  if (uri.length > MAX_INLINE_CHARS) throw new Error('That file is too large to send. Try a smaller one.');
  return {
    uri,
    name: a.name || 'attachment',
    mime,
    bytes: a.size ?? Math.ceil((b64.length * 3) / 4),
    width: null,
    height: null,
  };
}

/** the artifact row for a message that has already been written locally */
export async function attachPhoto(input: {
  workspace: string; channelId: string; taskId: string | null; messageId: string; photo: PickedPhoto;
}): Promise<void> {
  await getDb().execute(
    `insert into artifacts (id, workspace_id, channel_id, task_id, message_id, kind, name, mime, inline_content, size_bytes, width, height, promoted, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    // 'screenshot' is the kind the attachment contract gives a picture; everything else is 'file'.
    // Both are in the server's enum, and the viewer reads the mime rather than the kind, so a PDF
    // filed as 'file' still opens as a PDF.
    [randomUUID(), input.workspace, input.channelId, input.taskId, input.messageId,
     input.photo.mime.startsWith('image/') ? 'screenshot' : 'file',
     input.photo.name, input.photo.mime, input.photo.uri, input.photo.bytes,
     input.photo.width, input.photo.height, new Date().toISOString()],
  );
}
