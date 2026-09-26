// TEST-ONLY: a streamed reply with no brain behind it (web stream lane prototype, 2026-09-24).
//
// Echo mode proves the loop without spending a token, but its replies arrive whole, so it cannot
// show a live bubble. With NM_STREAM_FIXTURE=1 (and NM_AGENT_MODE=echo, so nothing here can ever
// run beside a real credential) a conversational wake writes this fixed markdown reply at a
// model's pace through the caller's onDelta — the SAME emitStream closure a real turn feeds — so
// the lanes that carry a live reply can be measured and filmed without a paid model.
//
// DETERMINISTIC. A seeded generator cuts the same bursts at the same offsets on every run, so a
// before and an after recording of one prompt are the same reply at the same speed.
//   NM_STREAM_FIXTURE_TTFT_MS   wait before the first token (default 1200: a model's first token)
//   NM_STREAM_FIXTURE_TPS       tokens per second (default 60, inside a hosted model's 40-80)

const REPLY = `Here is my plan for live replies on the web.

## What changes

1. **The machine sends the tokens.** Every reply already streams on the machine. Today the browser does not see those tokens, so the answer lands in one piece when the message syncs.
2. **The relay carries a new lane.** The browser opens one stream channel for each machine. The machine sends small deltas, never the full text again.
3. **The synced message wins.** When the reply is final, the saved message replaces the live bubble in place.

## Budgets

| Step | Budget |
| --- | --- |
| First token on screen | less than 300 ms after the machine has it |
| Each update | less than 100 ms, 30 frames a second at most |
| Bytes on the wire | the size of the reply, not its square |

## A quick check

\`\`\`ts
const lag = paintedAt - machineAt;
if (lag > 300) console.warn('stream lane lag', lag);
\`\`\`

If the relay is down, nothing breaks. The thread uses the current behavior, and the full reply still lands. Do you want a task for this change?`;

/** mulberry32: small, fast, and the same sequence for the same seed on every machine */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function streamFixture(env: NodeJS.ProcessEnv = process.env): { run(onDelta: (text: string) => void): Promise<string> } | null {
  if (env['NM_STREAM_FIXTURE'] !== '1' || env['NM_AGENT_MODE'] !== 'echo') return null;
  const ttft = Number(env['NM_STREAM_FIXTURE_TTFT_MS'] ?? 1200);
  const tps = Number(env['NM_STREAM_FIXTURE_TPS'] ?? 60);
  return {
    async run(onDelta) {
      const rand = seeded(20260924);
      // ~1.3 tokens per word: a burst is 1-5 words, so the gap between bursts follows the rate
      const words = REPLY.match(/\s*\S+/g) ?? [REPLY];
      await sleep(ttft);
      let i = 0;
      let text = '';
      while (i < words.length) {
        const n = 1 + Math.floor(rand() * 5);
        text += words.slice(i, i + n).join('');
        i += n;
        onDelta(text);
        if (i < words.length) await sleep(Math.round(((n * 1.3) / tps) * 1000 * (0.6 + rand() * 0.8)));
      }
      return REPLY;
    },
  };
}
