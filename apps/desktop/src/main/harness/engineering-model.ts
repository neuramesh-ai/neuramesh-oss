/** Deterministic OpenAI-compatible model used only by the local Engineering web harness.
 *
 * This is not a fake Engineering runtime: Cline Core still owns the agent loop, tool schemas,
 * approvals, checkpointing, filesystem mutation, command execution, and emitted events. This
 * server replaces only the paid model endpoint with a repeatable sequence so every contributor
 * can prove the whole product path locally without provider credentials or nondeterministic output.
 */
import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

interface ChatMessage {
  role?: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
}

interface ChatBody {
  model?: string;
  messages?: ChatMessage[];
  tools?: Array<{ function?: { name?: string } }>;
}

export type HarnessModelStep =
  | { kind: 'text'; text: string; reasoning?: string }
  | { kind: 'tool'; name: string; input: Record<string, unknown>; reasoning?: string };

const messageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => part && typeof part === 'object' && 'text' in part ? [String((part as { text: unknown }).text)] : []).join('\n');
};

const availableTools = (body: ChatBody): Set<string> => new Set((body.tools ?? []).flatMap((tool) => tool.function?.name ? [tool.function.name] : []));

/** Select the next deterministic action from the current root turn. HARNESS_PLAN and HARNESS_ACT
 * are deliberately explicit so arbitrary manual prompts receive an honest explanatory answer. */
export function engineeringHarnessModelStep(body: ChatBody): HarnessModelStep {
  const messages = body.messages ?? [];
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') { userIndex = index; break; }
  }
  const prompt = userIndex >= 0 ? messageText(messages[userIndex]?.content) : '';
  const turn = userIndex >= 0 ? messages.slice(userIndex + 1) : [];
  const called = new Set(turn.flatMap((message) => message.tool_calls?.flatMap((call) => call.function?.name ? [call.function.name] : []) ?? []));
  const tools = availableTools(body);
  const use = (name: string, input: Record<string, unknown>, reasoning?: string): HarnessModelStep | null => (
    tools.has(name) ? { kind: 'tool', name, input, reasoning } : null
  );

  if (prompt.includes('HARNESS_PLAN')) {
    if (!called.has('read_files')) return use(
      'read_files',
      { files: [{ path: 'README.md' }, { path: 'src/greeting.mjs' }, { path: 'test/greeting.test.mjs' }] },
      'I’ll inspect the fixture repository before proposing a read-only plan.',
    ) ?? { kind: 'text', text: 'The Engineering runtime could not find its read_files tool.' };
    return {
      kind: 'text',
      reasoning: 'I checked the repository files and matched the requested plan against the existing greeting contract.',
      text: 'Plan ready: update `src/greeting.mjs` so the greeting matches the repository contract, then run `node --test test/greeting.test.mjs`. No files were changed in Plan mode.',
    };
  }

  if (prompt.includes('HARNESS_ACT')) {
    if (!called.has('apply_patch') && !called.has('editor')) {
      const patch = use('apply_patch', {
        input: "*** Begin Patch\n*** Update File: src/greeting.mjs\n@@\n-export const greeting = () => 'hello';\n+export const greeting = () => 'hello engineering';\n*** End Patch",
      }, 'I’ll apply the fixture change through the repository editing tool.');
      const editor = use('editor', {
        path: 'src/greeting.mjs',
        old_text: "export const greeting = () => 'hello';",
        new_text: "export const greeting = () => 'hello engineering';",
      }, 'I’ll apply the fixture change through the repository editing tool.');
      return patch ?? editor ?? { kind: 'text', text: 'The Engineering runtime could not find its apply_patch or editor tool.' };
    }
    if (!called.has('run_commands')) return use(
      'run_commands',
      { commands: ['node --test test/greeting.test.mjs'] },
      'The edit is in place; I’ll run the focused repository test now.',
    ) ?? { kind: 'text', text: 'The Engineering runtime could not find its run_commands tool.' };
    return {
      kind: 'text',
      reasoning: 'The requested edit and focused verification command both completed successfully.',
      text: 'Implemented the greeting contract and verified it with `node --test test/greeting.test.mjs`.',
    };
  }

  return {
    kind: 'text',
    reasoning: 'Checking the deterministic Engineering harness connection and its supported test prompts.',
    text: 'The deterministic local model is ready. Use a prompt containing HARNESS_PLAN or HARNESS_ACT to run the documented end-to-end workflow, or configure real NM_ENGINEERING_* provider credentials.',
  };
}

const streamTextChunks = (text: string, targetLength = 18): string[] => {
  const words = text.match(/\S+\s*/g) ?? (text ? [text] : []);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    current += word;
    if (current.length >= targetLength) {
      chunks.push(current);
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks;
};

export const engineeringHarnessStreamDeltas = (step: HarnessModelStep): Array<Record<string, unknown>> => {
  const deltas: Array<Record<string, unknown>> = [];
  const reasoning = step.reasoning?.trim();
  if (reasoning) {
    streamTextChunks(reasoning).forEach((reasoningContent, index) => {
      deltas.push({
        ...(index === 0 ? { role: 'assistant' } : {}),
        reasoning_content: reasoningContent,
      });
    });
  }

  if (step.kind === 'tool') {
    deltas.push({
      ...(!reasoning ? { role: 'assistant' } : {}),
      tool_calls: [{ index: 0, id: `call-nm-${Date.now().toString(36)}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.input) } }],
    });
    return deltas;
  }

  streamTextChunks(step.text).forEach((content, index) => {
    deltas.push({ ...(!reasoning && index === 0 ? { role: 'assistant' } : {}), content });
  });
  return deltas;
};

const delay = (durationMs: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, durationMs));

const sse = async (res: import('node:http').ServerResponse, body: ChatBody, step: HarnessModelStep): Promise<void> => {
  const id = `chatcmpl-nm-${Date.now().toString(36)}`;
  const model = body.model ?? 'neuramesh-harness';
  const streamDelayMs = Math.max(0, Number(process.env['NM_ENGINEERING_HARNESS_STREAM_DELAY_MS'] ?? 90));
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) => ({
    id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.socket?.setNoDelay(true);
  for (const delta of engineeringHarnessStreamDeltas(step)) {
    res.write(`data: ${JSON.stringify(chunk(delta, null))}\n\n`);
    if (streamDelayMs > 0) await delay(streamDelayMs);
  }
  res.write(`data: ${JSON.stringify(chunk({}, step.kind === 'tool' ? 'tool_calls' : 'stop'))}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();
};

export function startEngineeringHarnessModel(port = Number(process.env['PORT'] ?? 8790)): Server {
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, model: 'neuramesh-harness' }));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'neuramesh-harness', object: 'model', owned_by: 'neuramesh' }] }));
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as ChatBody;
        const step = engineeringHarnessModelStep(body);
        console.log(`[engineering-model] ${step.kind === 'tool' ? `tool=${step.name}` : 'final=text'}`);
        await sse(res, body, step);
      } catch (error: unknown) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : String(error) } }));
      }
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`[engineering-model] listening on http://127.0.0.1:${port}/v1`));
  return server;
}

const direct = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (direct) startEngineeringHarnessModel();
