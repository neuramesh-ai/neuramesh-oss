import { sniffImageMime } from '@neuramesh/shared';

export type ImageOutput = { bytes?: Buffer; mime?: string; thumb?: string; error?: string };

/** Storage and downloads keep the provider's bytes. A thumbnail is never an original. */
export function originalImage(image: ImageOutput): { bytes: Buffer; mime: string; dataUrl: string; extension: string } {
  if (image.error) throw new Error(image.error);
  if (!image.bytes?.length) throw new Error('The generator did not return the original image.');
  if (image.bytes.length > 16 * 1024 * 1024) throw new Error('The original image exceeds the 16 MB storage limit.');
  const mime = sniffImageMime(image.bytes);
  if (!mime) throw new Error('The generator returned an unsupported image.');
  return { bytes: image.bytes, mime, dataUrl: `data:${mime};base64,${image.bytes.toString('base64')}`,
    extension: mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length) };
}
