import { BrainError } from './brain-error';

export function brainCloudOnly(workspace: string): boolean {
  return process.env['NM_BRAIN_CLOUD_ONLY_ARTIFACTS'] === '1'
    || (process.env['NM_BRAIN_CLOUD_ONLY_WORKSPACES'] ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(workspace);
}

/** Workspace replicas can retain small shared artifacts for older readers. Private Code bytes
 * must never enter those replicas: enable those writes only after the scoped reader rollout. */
export function brainArtifactInline(bytes: Buffer, mime: string, workspace: string, privateCode = false): string | null {
  if (brainCloudOnly(workspace)) return null;
  if (privateCode) throw new BrainError('BRAIN_READER_UPGRADE_REQUIRED',
    'Private coding artifacts require compatible readers. Enable this workspace after its clients are upgraded; the upload remains queued.', 409);
  const value = /^(text\/|application\/(json|xml|javascript)(;|$))/.test(mime)
    ? bytes.toString('utf8') : `data:${mime};base64,${bytes.toString('base64')}`;
  if (Buffer.byteLength(value) > 400_000) throw new BrainError('BRAIN_READER_UPGRADE_REQUIRED',
    'This server retains compatibility with older artifact readers. Use an artifact under 400 kB until cloud-only storage is enabled after the client upgrade.', 413);
  return value;
}
