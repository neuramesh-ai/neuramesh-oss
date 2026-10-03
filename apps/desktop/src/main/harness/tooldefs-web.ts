// the agents' browser on the bus (models-and-replies round, board C3): web_open, web_read, web_click,
// web_type and web_screenshot for a Codex, Gemini or Starter turn. they travel as a set, like the
// whiteboard four, and the words and shapes come from the one table (toolspec.ts). the work happens
// in browser/agent-tools.ts behind `host.web`, so these only forward, and the tool logs its own call.
import { z } from 'zod';
import { TOOL_SPECS, type SpeccedTool } from './toolspec';
import { text } from './toolbus';
import type { ToolDef } from './toolbus';

const spec = (name: SpeccedTool) => ({ name, description: TOOL_SPECS[name].description, params: TOOL_SPECS[name].params(z) });
const NONE = 'the browser is unavailable on this turn';

export const WEB_DEFS: ToolDef[] = [
  {
    ...spec('web_open'),
    async run(host, input) { return text(host.web ? await host.web.open({ url: String(input['url']) }) : NONE); },
  },
  {
    ...spec('web_read'),
    async run(host, input) { return text(host.web ? await host.web.read({ ...(typeof input['from'] === 'number' ? { from: input['from'] } : {}) }) : NONE); },
  },
  {
    ...spec('web_click'),
    async run(host, input) {
      if (!host.web) return text(NONE);
      return text(await host.web.click({ ...(input['text'] ? { text: String(input['text']) } : {}), ...(input['selector'] ? { selector: String(input['selector']) } : {}) }));
    },
  },
  {
    ...spec('web_type'),
    async run(host, input) {
      if (!host.web) return text(NONE);
      return text(await host.web.type({ selector: String(input['selector']), text: String(input['text'] ?? ''), ...(input['submit'] === true ? { submit: true } : {}) }));
    },
  },
  {
    ...spec('web_screenshot'),
    async run(host, input) { return text(host.web ? await host.web.screenshot({ ...(input['name'] ? { name: String(input['name']) } : {}) }) : NONE); },
  },
];
