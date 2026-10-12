import { plainTitle } from '@neuramesh/shared';

export function engineeringTitleTool(setTitle: (title: string) => Promise<unknown>) {
  return {
    name: 'set_thread_title',
    description: 'Name this coding conversation once after understanding the first request. Use a concise 2–6 word topic title, not a copy of the prompt. This changes only thread metadata, never repository files. Existing generated titles and human renames are preserved by the server.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['title'], properties: {
      title: { type: 'string', minLength: 1, maxLength: 100 },
    } },
    execute: async (input: unknown) => {
      const value = (input as { title?: unknown } | null)?.title;
      if (typeof value !== 'string' || !plainTitle(value) || value.length > 100) throw new Error('Supply a short plain-text thread title.');
      return setTitle(plainTitle(value));
    },
  };
}

export function engineeringThreadNamer(options: {
  apiUrl: string; workspaceId: string; threadId: string;
  headers: () => Promise<Record<string, string>>; fetchImpl?: typeof fetch;
}): (title: string) => Promise<unknown> {
  return async title => {
    const response = await (options.fetchImpl ?? fetch)(`${options.apiUrl}/v1/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...await options.headers() },
      body: JSON.stringify({ type: 'code_session.name', workspace: options.workspaceId, codeSessionId: options.threadId, title }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`The thread title could not be saved (${response.status}).`);
    return response.json();
  };
}
