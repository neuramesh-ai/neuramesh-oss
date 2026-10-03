// the agents' browser on the Claude in-process server (models-and-replies round, board C3): the
// five clones of the bus tools, closure-gated like the repository reads (the host hands `web` only
// where the machine runs Chromium), one implementation behind them (browser/agent-tools.ts). the
// words come from the one table (harness/toolspec.ts), and the tool logs its own call.
import type { WebTools } from '../browser/agent-tools';
import { TOOL_SPECS } from '../harness/toolspec';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk');
type Zod = typeof import('zod')['z'];
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

/** the names the Claude runtime allows when a turn carries `web` (claudecode.ts allowedTools) */
export const WEB_TOOL_NAMES = ['web_open', 'web_read', 'web_click', 'web_type', 'web_screenshot'] as const;

export function webClones(web: WebTools, tool: Sdk['tool'], z: Zod) {
  return [
    tool('web_open', TOOL_SPECS.web_open.description, TOOL_SPECS.web_open.params(z), async (input) => text(await web.open({ url: input.url }))),
    tool('web_read', TOOL_SPECS.web_read.description, TOOL_SPECS.web_read.params(z), async (input) => text(await web.read({ ...(input.from !== undefined ? { from: input.from } : {}) }))),
    tool('web_click', TOOL_SPECS.web_click.description, TOOL_SPECS.web_click.params(z), async (input) =>
      text(await web.click({ ...(input.text ? { text: input.text } : {}), ...(input.selector ? { selector: input.selector } : {}) }))),
    tool('web_type', TOOL_SPECS.web_type.description, TOOL_SPECS.web_type.params(z), async (input) =>
      text(await web.type({ selector: input.selector, text: input.text, ...(input.submit ? { submit: true } : {}) }))),
    tool('web_screenshot', TOOL_SPECS.web_screenshot.description, TOOL_SPECS.web_screenshot.params(z), async (input) =>
      text(await web.screenshot({ ...(input.name ? { name: input.name } : {}) }))),
  ];
}
