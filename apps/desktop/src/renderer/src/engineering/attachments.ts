import { attachmentLimits, attachmentUpgradeReason } from '@neuramesh/shared';
import { useCallback, useRef, useState } from 'react';
import { readFileWithProgress, type AttachItem } from '../composer/attach';

export interface EngineeringAttachmentUpload {
  id: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** Code attachments stay in browser memory until send, then travel to the selected machine in
 * bounded relay chunks. They are never staged on the web server or copied into the worktree. */
export function useEngineeringAttachments(plan: string, onUpgrade: (reason: string) => void) {
  const [items, setItems] = useState<AttachItem[]>([]);
  const itemsRef = useRef<AttachItem[]>([]);
  const bytesRef = useRef(new Map<string, Uint8Array>());
  itemsRef.current = items;
  const limits = attachmentLimits(plan);
  const patch = useCallback((id: string, value: Partial<AttachItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  }, []);
  const stage = useCallback(async (item: AttachItem, file: File) => {
    try {
      const buffer = await readFileWithProgress(file, (progress) => patch(item.id, { progress: Math.min(.95, progress) }));
      bytesRef.current.set(item.id, new Uint8Array(buffer));
      patch(item.id, { status: 'ready', progress: 1 });
    } catch {
      patch(item.id, { status: 'error', progress: 1 });
    }
  }, [patch]);
  const addFiles = useCallback((files: File[]) => {
    if (!files.length) return;
    const room = limits.maxPerMessage - itemsRef.current.length;
    if (room <= 0) { onUpgrade(attachmentUpgradeReason('count')); return; }
    const accepted: File[] = [];
    let overCount = false;
    let overSize = false;
    for (const file of files) {
      if (accepted.length >= room) { overCount = true; break; }
      if (file.size > limits.maxBytes) { overSize = true; continue; }
      accepted.push(file);
    }
    const fresh = accepted.map((file): AttachItem => ({
      id: crypto.randomUUID(), name: file.name || 'file', mime: file.type || 'application/octet-stream', size: file.size,
      isImage: file.type.startsWith('image/'), url: URL.createObjectURL(file), status: 'staging', progress: 0,
    }));
    if (fresh.length) {
      setItems((current) => [...current, ...fresh]);
      fresh.forEach((item, index) => void stage(item, accepted[index]!));
    }
    if (overCount) onUpgrade(attachmentUpgradeReason('count'));
    else if (overSize) onUpgrade(attachmentUpgradeReason('size'));
  }, [limits.maxBytes, limits.maxPerMessage, onUpgrade, stage]);
  const remove = useCallback((id: string) => {
    const item = itemsRef.current.find((candidate) => candidate.id === id);
    if (item) URL.revokeObjectURL(item.url);
    bytesRef.current.delete(id);
    setItems((current) => current.filter((candidate) => candidate.id !== id));
  }, []);
  const reset = useCallback(() => {
    itemsRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    bytesRef.current.clear();
    setItems([]);
  }, []);
  const uploads = useCallback((): EngineeringAttachmentUpload[] => itemsRef.current.flatMap((item) => {
    const bytes = bytesRef.current.get(item.id);
    return item.status === 'ready' && bytes ? [{ id: item.id, name: item.name, mime: item.mime, bytes }] : [];
  }), []);
  return { items, addFiles, remove, reset, uploads, count: items.length, busy: items.some((item) => item.status === 'staging'), limits };
}
