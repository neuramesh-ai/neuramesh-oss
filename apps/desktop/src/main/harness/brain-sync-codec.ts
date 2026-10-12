import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { BrainConversationEvent } from '@neuramesh/shared';

const PACKED = 'neuramesh.gzip.v1';

export function packRuntime(messages: unknown[]): unknown[] {
  const json = JSON.stringify(messages);
  if (Buffer.byteLength(json) > 128 * 1024 * 1024) throw new Error('The full runtime checkpoint exceeds the 128 MB restore limit and remains in the local brain.');
  return Buffer.byteLength(json) < 1024 * 1024 ? messages : [{ brainEncoding: PACKED, data: gzipSync(json).toString('base64') }];
}
export function unpackRuntime(messages: unknown[] | undefined): unknown[] | undefined {
  const first = messages?.[0] as { brainEncoding?: unknown; data?: unknown } | undefined;
  if (messages?.length !== 1 || first?.brainEncoding !== PACKED || typeof first.data !== 'string') return messages;
  const decoded: unknown = JSON.parse(gunzipSync(Buffer.from(first.data, 'base64'), { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8'));
  if (!Array.isArray(decoded)) throw new Error('The cloud runtime snapshot is invalid.');
  return decoded;
}
export function packEvent(event: BrainConversationEvent): BrainConversationEvent {
  const json = JSON.stringify(event.payload);
  if (Buffer.byteLength(json) > 128 * 1024 * 1024) throw new Error('The full event exceeds the 128 MB restore limit and remains in the local brain.');
  return Buffer.byteLength(json) < 1024 * 1024 ? event : { ...event, payload: { brainEncoding: PACKED, data: gzipSync(json).toString('base64') } };
}
export function unpackEvent(event: BrainConversationEvent): BrainConversationEvent {
  const payload = event.payload as { brainEncoding?: unknown; data?: unknown } | null;
  if (payload?.brainEncoding !== PACKED || typeof payload.data !== 'string') return event;
  return { ...event, payload: JSON.parse(gunzipSync(Buffer.from(payload.data, 'base64'), { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8')) };
}
const SECRET_KEY = /^(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|cookie|set-cookie|credentials|env|environment)$/i;
const SECRET_TEXT = /\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{16,}|gh[ps]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|AIza[A-Za-z0-9_-]{30,})\b/g;

/** Preserve complete content, while removing credential fields and known provider tokens. */
export function portableBrainValue<T>(value: T, secrets: readonly string[] = []): T {
  const ancestors: object[] = [];
  const encoded = JSON.stringify(value, function (this: unknown, key, item: unknown) {
    if (SECRET_KEY.test(key)) return '[redacted]';
    if (typeof item === 'string') {
      let text = item.replace(SECRET_TEXT, '[redacted]')
        .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[redacted]')
        .replace(/([?&](?:X-Goog-Signature|X-Goog-Credential|access_token|token)=)[^&\s]+/gi, '$1[redacted]');
      for (const secret of secrets) if (secret.length >= 6) text = text.split(secret).join('[redacted]');
      return text;
    }
    if (item instanceof Error) return { name: item.name, message: item.message };
    if (item && typeof item === 'object') {
      while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
      if (ancestors.includes(item)) return '[circular]';
      ancestors.push(item);
    }
    return item;
  });
  return (encoded === undefined ? null : JSON.parse(encoded)) as T;
}

export function durableWrite(file: string, text: string): void {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, file);
  const directory = openSync(join(file, '..'), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function readJSON<T>(file: string, fallback: T): T {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
}


/** A new journal name also needs a directory sync before a turn can rely on it. */
export function durableAppend(file: string, text: string): void {
  const created = !existsSync(file);
  const fd = openSync(file, 'a', 0o600);
  try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  if (created) {
    const directory = openSync(join(file, '..'), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}
