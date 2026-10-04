// the agents' browser on the orchestrator's belt (models-and-replies round, board C3): rex, on any
// brain, opens and reads a page, clicks, types, and saves a screenshot into the thread. the
// NeuraMesh brain runs this same registry (orchturn.ts geminiOrchestratorTurn), so it gets them too.
// the words come from harness/tooldesc.ts and the work from browser/agent-tools.ts, the same two the
// conversation registry and the worker bus use. on a machine with no Chromium the group is empty,
// and the shared catalogue keeps it off a sweep (toolAvailable).
import { toolAvailable, type NmTool } from '@neuramesh/shared';
import { WEB_CLICK_DESC, WEB_OPEN_DESC, WEB_READ_DESC, WEB_SCREENSHOT_DESC, WEB_TYPE_DESC, webClickParams, webOpenParams, webReadParams, webScreenshotParams, webTypeParams } from '../harness/tooldesc';
import { webToolsFor } from '../browser/agent-tools';
import { IN_THREAD, threadShot } from './webshot';
import type { OrchTool, ToolCtx } from './orchtools';

export function webTools(tc: ToolCtx): OrchTool[] {
  const { z, post, ch, agent, actor, thread, convoThreadId, log, kind, here } = tc;
  const web = webToolsFor({
    agentName: agent.name, savedWhere: IN_THREAD, ...(log ? { log } : {}),
    attach: threadShot(post, actor, () => ({ workspaceId: ch.workspace_id, channelId: here(), threadId: convoThreadId ?? null, taskId: thread?.id ?? null })),
  });
  if (!web) return [];
  const tools: OrchTool[] = [
    { name: 'web_open', description: WEB_OPEN_DESC, schema: webOpenParams(z), run: (i: { url: string }) => web.open(i) },
    { name: 'web_read', description: WEB_READ_DESC, schema: webReadParams(z), run: (i: { from?: number }) => web.read(i) },
    { name: 'web_click', description: WEB_CLICK_DESC, schema: webClickParams(z), run: (i: { text?: string; selector?: string }) => web.click(i) },
    { name: 'web_type', description: WEB_TYPE_DESC, schema: webTypeParams(z), run: (i: { selector: string; text: string; submit?: boolean }) => web.type(i) },
    { name: 'web_screenshot', description: WEB_SCREENSHOT_DESC, schema: webScreenshotParams(z), run: (i: { name?: string }) => web.screenshot(i) },
  ];
  return tools.filter((t) => toolAvailable(t.name as NmTool, kind));
}
