// Boot-time memory maintenance, gated on NM_EMBED: warm the local embedder so
// the ~5s ONNX init never lands on a live recall, then backfill embeddings for
// rows written while the embedder was off (they stay NULL forever otherwise —
// the vector recall legs skip them). Never runs on Vercel: fastembed is not in
// the serverless bundle and NM_EMBED is unset there, so recall stays FTS-only.
import { embedderEnabled, warmEmbedder } from './embedder';

type BackfillStore = { backfillEmbeddings?: (batch: number) => Promise<{ messages: number; facts: number }> };

export function startMemoryMaintenance(store: unknown): void {
  if (!embedderEnabled()) return;
  void (async () => {
    const ms = await warmEmbedder();
    if (ms == null) return; // init failed — embed() already logged; recall degrades to FTS
    console.log(`embedder_ready ms=${ms}`);
    const backfill = (store as BackfillStore).backfillEmbeddings?.bind(store);
    if (!backfill) return; // memory store — nothing durable to backfill
    let messages = 0;
    let facts = 0;
    for (;;) {
      try {
        const n = await backfill(32);
        messages += n.messages;
        facts += n.facts;
        if (n.messages === 0 && n.facts === 0) break;
        // background pace — never contend with live queries for the pool
        await new Promise((r) => setTimeout(r, 50));
      } catch (err) {
        console.error('embed_backfill failed (resumes next boot):', err instanceof Error ? err.message : err);
        return;
      }
    }
    if (messages || facts) console.log(`embed_backfill messages=${messages} facts=${facts} done`);
  })();
}
