// the agents' browser in the conversation (models-and-replies round, board C3): a chat turn asked
// "what does their pricing page say" opens the page in the agents' browser on this cloud machine
// and reads it, with the words the orchestrator and the worker bus use (harness/tooldesc.ts) and
// the one implementation behind all three (browser/agent-tools.ts). split from chattools.ts at its
// size gate, like the repository reads. no Chromium on the machine: no tools.
import { WEB_CLICK_DESC, WEB_OPEN_DESC, WEB_READ_DESC, WEB_SCREENSHOT_DESC, WEB_TYPE_DESC, webClickParams, webOpenParams, webReadParams, webScreenshotParams, webTypeParams } from '../harness/tooldesc';
import { webToolsFor } from '../browser/agent-tools';
import { IN_THREAD, threadShot } from './webshot';
import type { ChatToolCtx } from './chattools';

export function webChatTools(t: Pick<ChatToolCtx, 'z' | 'tool' | 'text' | 'agent' | 'ch' | 'threadId' | 'log' | 'post'>) {
  const { z, tool, text, agent, ch, threadId, log, post } = t;
  const actor = { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) };
  const web = webToolsFor({ agentName: agent.name, log, savedWhere: IN_THREAD, attach: threadShot(post, actor, () => ({ workspaceId: ch.workspace_id, channelId: ch.id, threadId })) });
  if (!web) return [];
  return [
    tool('web_open', WEB_OPEN_DESC, webOpenParams(z), async (i) => text(await web.open({ url: String(i.url) }))),
    tool('web_read', WEB_READ_DESC, webReadParams(z), async (i) => text(await web.read({ ...(typeof i.from === 'number' ? { from: i.from } : {}) }))),
    tool('web_click', WEB_CLICK_DESC, webClickParams(z), async (i) => text(await web.click({ ...(i.text ? { text: String(i.text) } : {}), ...(i.selector ? { selector: String(i.selector) } : {}) }))),
    tool('web_type', WEB_TYPE_DESC, webTypeParams(z), async (i) => text(await web.type({ selector: String(i.selector), text: String(i.text), ...(i.submit ? { submit: true } : {}) }))),
    tool('web_screenshot', WEB_SCREENSHOT_DESC, webScreenshotParams(z), async (i) => text(await web.screenshot({ ...(i.name ? { name: String(i.name) } : {}) }))),
  ];
}
