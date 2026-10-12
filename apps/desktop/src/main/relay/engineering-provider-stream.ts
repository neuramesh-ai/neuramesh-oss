export interface EngineeringStreamReceipt {
  requestId: string;
  elapsedMs: number;
  outcome: 'complete' | 'cancelled' | 'timeout' | 'error';
  phase: 'headers' | 'body';
  status?: number;
  chunks: number;
  bytes: number;
  lastEvent?: string;
  terminalEvent?: string;
  tool?: string;
  argumentChars?: number;
  argumentNonWhitespaceChars?: number;
  timeoutKind?: 'network' | 'provider_progress' | 'tool_arguments';
}

/** Bound network inactivity and unfinished tool calls, not total turn or approval time.
 * This layer never retries: replaying a partially delivered tool call could repeat a write.
 * Receipts contain transport metadata only, never credentials, prompts or generated content.
 */
export function engineeringProviderFetch(call: typeof fetch, observe: (receipt: EngineeringStreamReceipt) => void, idleMs = 120_000, toolMs = 120_000): typeof fetch {
  return async (input, init) => {
    const started = Date.now();
    const abort = new AbortController();
    const caller = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const signal = caller ? AbortSignal.any([caller, abort.signal]) : abort.signal;
    signal.throwIfAborted();
    const receipt: EngineeringStreamReceipt = { requestId: crypto.randomUUID(), elapsedMs: 0, outcome: 'complete', phase: 'headers', chunks: 0, bytes: 0 };
    let reported = false;
    const report = (outcome: EngineeringStreamReceipt['outcome']) => {
      if (reported) return;
      reported = true;
      // Diagnostics must not change the request's outcome.
      try { observe({ ...receipt, elapsedMs: Date.now() - started, outcome }); } catch { /* host logger unavailable */ }
    };
    const expire = (kind: NonNullable<EngineeringStreamReceipt['timeoutKind']>) => {
      receipt.timeoutKind = kind;
      const message = kind === 'tool_arguments'
        ? `The model did not finish a tool call within ${Math.round(toolMs / 1000)} seconds. Retry this turn with a smaller step or choose another model.`
        : `The model stopped ${kind === 'provider_progress' ? 'making progress' : 'responding'} for ${Math.round(idleMs / 1000)} seconds. Retry this turn or choose another model.`;
      abort.abort(new DOMException(message, 'TimeoutError'));
      return abort.signal.reason;
    };
    const bounded = async <T>(operation: Promise<T>, timeoutMs = idleMs, kind: NonNullable<EngineeringStreamReceipt['timeoutKind']> = 'network'): Promise<T> => {
      let cancelled = () => {};
      const interrupted = new Promise<never>((_resolve, reject) => {
        cancelled = () => reject(signal.reason);
        signal.addEventListener('abort', cancelled, { once: true });
        if (signal.aborted) cancelled();
      });
      const timer = setTimeout(() => expire(kind), timeoutMs);
      try { return await Promise.race([operation, interrupted]); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', cancelled); }
    };
    const failed = () => report(abort.signal.aborted ? 'timeout' : caller?.aborted ? 'cancelled' : 'error');
    let response: Response;
    try { response = await bounded(call(input, { ...init, signal })); }
    catch (error) { failed(); throw error; }
    receipt.status = response.status;
    if (!response.body) { report('complete'); return response; }
    receipt.phase = 'body';
    const reader = response.body.getReader();
    const isSse = response.headers.get('content-type')?.includes('text/event-stream');
    const decoder = new TextDecoder();
    let pending = '';
    let discarding = false;
    // Track JSON syntax only, never retain argument content. Padding outside strings is
    // not useful progress; a provider can stream it forever while keeping HTTP alive.
    let providerReadMs = 0;
    let progressReadMs = 0;
    const argumentsByItem = new Map<string | number, { quoted: boolean; escaped: boolean; padding: number; started: number }>();
    const inspectArguments = (key: string | number, delta: string) => {
      let state = argumentsByItem.get(key);
      if (!state) {
        if (argumentsByItem.size >= 128) argumentsByItem.delete(argumentsByItem.keys().next().value!);
        state = { quoted: false, escaped: false, padding: 0, started: providerReadMs };
        argumentsByItem.set(key, state);
      }
      for (const char of delta) {
        if (state.quoted) {
          if (state.escaped) state.escaped = false;
          else if (char === '\\') state.escaped = true;
          else if (char === '"') state.quoted = false;
        } else if (char === ' ' || char === '\n' || char === '\r' || char === '\t') {
          if (++state.padding > 8192) {
            receipt.timeoutKind = 'tool_arguments';
            abort.abort(new DOMException('The model kept streaming empty tool arguments without finishing a call. Retry this turn or choose another model.', 'TimeoutError'));
            signal.throwIfAborted();
          }
        } else {
          state.padding = 0;
          if (char === '"') state.quoted = true;
        }
      }
    };
    const inspect = (chunk: Uint8Array) => {
      receipt.chunks++; receipt.bytes += chunk.byteLength;
      if (!isSse) return;
      const lines = (pending + decoder.decode(chunk, { stream: true })).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (discarding) { discarding = false; continue; }
        if (line.length > 65_536) continue;
        let type: unknown;
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) {
          let data;
          try { data = JSON.parse(line.slice(5)); } catch { continue; /* SSE sentinel */ }
          if (!data || typeof data !== 'object') continue;
          type = data.type;
          // SSE comments, ping/keepalive frames and empty chat chunks cannot reset
          // the deadline. Native reasoning/text/tool events are real progress.
          if ((typeof type === 'string' && (type.startsWith('response.') || /^(message_(start|delta|stop)|content_block_(start|delta|stop)|error)$/.test(type)))
            || (Array.isArray(data.choices) && data.choices.some((choice: { delta?: Record<string, unknown>; finish_reason?: string } | null) => choice && (choice.finish_reason || (choice.delta && Object.keys(choice.delta).length > 0))))
            || (Array.isArray(data.candidates) && data.candidates.length)) progressReadMs = providerReadMs;
          const key = typeof data.item_id === 'string' ? data.item_id : typeof data.item?.id === 'string' ? data.item.id : typeof data.output_index === 'number' ? data.output_index : 0;
          if (data.item?.type === 'function_call' && typeof data.item.name === 'string' && /^[a-z_]{1,80}$/.test(data.item.name)) receipt.tool = data.item.name;
          if (type === 'response.output_item.added' && data.item?.type === 'function_call') inspectArguments(key, typeof data.item.arguments === 'string' ? data.item.arguments : '');
          if (type === 'response.function_call_arguments.delta' && typeof data.delta === 'string') {
            receipt.argumentChars = (receipt.argumentChars ?? 0) + data.delta.length;
            receipt.argumentNonWhitespaceChars = (receipt.argumentNonWhitespaceChars ?? 0) + data.delta.replace(/\s/g, '').length;
            inspectArguments(key, data.delta);
          }
          if (type === 'response.function_call_arguments.done' || type === 'response.output_item.done') argumentsByItem.delete(key);
        }
        if (typeof type !== 'string' || !/^[a-z_.-]{1,80}$/.test(type)) continue;
        receipt.lastEvent = type;
        if (['response.completed', 'response.incomplete', 'response.failed', 'message_stop'].includes(type)) receipt.terminalEvent = type;
      }
      if (pending.length > 65_536) { pending = ''; discarding = true; }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          // Only time waiting on the provider counts. A downstream tool/approval pause
          // can last indefinitely without using this per-call generation budget.
          const argumentRemaining = Math.min(Infinity, ...[...argumentsByItem.values()].map(item => toolMs - (providerReadMs - item.started)));
          const progressRemaining = isSse ? idleMs - (providerReadMs - progressReadMs) : idleMs;
          const remaining = Math.min(progressRemaining, argumentRemaining);
          const kind = argumentRemaining <= progressRemaining ? 'tool_arguments' : progressRemaining < idleMs ? 'provider_progress' : 'network';
          if (remaining <= 0) throw expire(kind);
          const readStarted = Date.now();
          const { value, done } = await bounded(reader.read(), remaining, kind);
          providerReadMs += Date.now() - readStarted;
          if (done) { report('complete'); controller.close(); reader.releaseLock(); return; }
          inspect(value); controller.enqueue(value);
        } catch (error) {
          failed(); controller.error(error);
          void reader.cancel(error).catch(() => {});
        }
      },
      async cancel(reason) { report('cancelled'); abort.abort(reason); await reader.cancel(reason); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
