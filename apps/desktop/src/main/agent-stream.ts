import { visibleStream, type ImageGenerationProgress } from '@neuramesh/shared';
import { electron } from './electronlazy';
import { liveStreams } from './livestreams';

type Entry = { agent: string; text: string; thinking?: string; images: Map<symbol, ImageGenerationProgress> };

/** Preserve the reply while image tools publish progress on the same live surface. */
export function createAgentStream(send: (key: string, agent: string, text: string, done: boolean, thinking?: string, imageGeneration?: ImageGenerationProgress | null) => void) {
  const entries = new Map<string, Entry>();
  const publish = (key: string, entry: Entry, done = false) => {
    const images = [...entry.images.values()];
    const progress = !done && images.length ? { count: images.reduce((sum, image) => sum + image.count, 0), stage: images.some(image => image.stage === 'generating') ? 'generating' as const : 'saving' as const } : null;
    send(key, entry.agent, entry.text, done, entry.thinking, progress);
  };
  const emit = (key: string, agent: string, text: string, done: boolean, thinking?: string) => {
    let entry = entries.get(key);
    if (done) { entries.delete(key); send(key, agent, text, true, thinking, null); return; }
    if (!entry || entry.agent !== agent) { entry = { agent, text: '', images: new Map() }; entries.set(key, entry); }
    entry.text = text;
    if (thinking !== undefined) entry.thinking = thinking;
    publish(key, entry);
  };
  const image = (keys: string[], agent: string, count = 1) => {
    const token = Symbol('image');
    const owned = new Set<string>();
    const held = keys.map(key => {
      if (!entries.has(key)) { owned.add(key); emit(key, agent, '', false); }
      const entry = entries.get(key)!;
      if (entry.agent !== agent) return null;
      entry.images.set(token, { count, stage: 'generating' }); publish(key, entry);
      return { key, entry };
    });
    const update = (stage: 'saving' | null) => {
      for (const row of held) {
        if (!row || entries.get(row.key) !== row.entry || !row.entry.images.has(token)) continue;
        if (stage) row.entry.images.set(token, { count, stage }); else row.entry.images.delete(token);
        if (!stage && owned.has(row.key) && !row.entry.images.size) emit(row.key, agent, row.entry.text, true, row.entry.thinking);
        else publish(row.key, row.entry);
      }
    };
    return { saving: () => update('saving'), finish: () => update(null) };
  };
  return { emit, image };
}

const stream = createAgentStream((key, agent, text, done, thinking, imageGeneration) => {
  const { text: visible, forming } = visibleStream(text);
  const body = forming ? `${visible}${visible ? '\n\n' : ''}› *${forming === 'drafts' ? 'updating the drafts' : 'question card forming'}…*` : visible;
  for (const w of electron()?.BrowserWindow.getAllWindows() ?? []) {
    if (!w.webContents.isDestroyed()) w.webContents.send('nm:agent-stream', { key, agent, text: body, done, thinking, imageGeneration });
  }
  liveStreams.publish(key, agent, body, done, thinking, imageGeneration);
});
export const emitStream = stream.emit;
export function beginImageGeneration(channelId: string, agent: string, anchor: { taskId?: string | null; threadId?: string | null }, count = 1) {
  const subject = anchor.taskId ?? anchor.threadId;
  return stream.image([`${channelId}:`, ...(subject ? [`${channelId}:${subject}`] : [])], agent, count);
}
