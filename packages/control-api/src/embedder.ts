// Local ONNX embeddings (bge-small-en-v1.5, 384-dim) — the platform never
// holds inference keys; the model runs in-process on CPU. Off by default:
// gates stay hermetic (no model download), recall degrades to FTS-only.
// Enable with NM_EMBED=on (first use downloads ~30MB to .fastembed-cache).

let modelP: Promise<any> | null = null;

export function embedderEnabled(): boolean {
  return process.env['NM_EMBED'] === 'on';
}

async function model(): Promise<any> {
  if (!modelP) {
    // Computed specifier so static bundlers/tracers (notably Vercel's @vercel/nft)
    // do NOT pull fastembed — and its ~500MB onnxruntime-node GPU native dep — into
    // serverless bundles where it's never used (NM_EMBED off blows the function size
    // limit otherwise). Resolved at runtime from node_modules only when embeddings
    // are enabled; the desktop externalises prod deps so it still loads there.
    const pkg = 'fastembed' as string;
    modelP = import(/* @vite-ignore */ pkg).then((m: any) =>
      m.FlagEmbedding.init({ model: m.EmbeddingModel.BGESmallENV15, cacheDir: '.fastembed-cache', showDownloadProgress: false }),
    );
  }
  return modelP;
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!embedderEnabled() || texts.length === 0) return null;
  try {
    const fe = await model();
    const out: number[][] = [];
    for await (const batch of fe.embed(texts, 16)) {
      for (const v of batch) out.push(Array.from(v as Float32Array));
    }
    return out;
  } catch (err) {
    console.error('embed failed (recall degrades to FTS):', err instanceof Error ? err.message : err);
    return null;
  }
}

// Pays the one-time model download + ONNX init at boot instead of on the first
// live recall (measured ~4.9s cold — 24x the 200ms recall budget).
export async function warmEmbedder(): Promise<number | null> {
  if (!embedderEnabled()) return null;
  const t0 = performance.now();
  const v = await embed(['neuramesh embedder warmup']);
  return v ? Math.round(performance.now() - t0) : null;
}
