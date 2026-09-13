import type { NMBridge } from '../bridge/nm';
import type { EngineeringAttachmentUpload } from './attachments';

type Handle = ReturnType<NonNullable<NMBridge['openEngineering']>>;
export const ENGINEERING_ATTACHMENT_CHUNK_BYTES = 128 * 1024;

const base64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary);
};

/** Upload every attachment with relay acknowledgement before starting the model turn. */
export async function sendEngineeringPrompt(handle: Handle, prompt: string, uploads: EngineeringAttachmentUpload[]): Promise<void> {
  for (const upload of uploads) {
    await handle.send({ type: 'attachment_start', id: upload.id, name: upload.name, mime: upload.mime, size: upload.bytes.byteLength });
    for (let offset = 0, index = 0; offset < upload.bytes.byteLength; offset += ENGINEERING_ATTACHMENT_CHUNK_BYTES, index += 1) {
      await handle.send({ type: 'attachment_chunk', id: upload.id, index, data: base64(upload.bytes.subarray(offset, offset + ENGINEERING_ATTACHMENT_CHUNK_BYTES)) });
      if (index % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    await handle.send({ type: 'attachment_end', id: upload.id });
  }
  await handle.send({ type: 'prompt', prompt, ...(uploads.length ? { attachments: uploads.map(({ id, name, mime }) => ({ id, name, mime })) } : {}) });
}
