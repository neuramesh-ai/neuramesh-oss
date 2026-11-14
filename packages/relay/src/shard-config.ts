// A RELAY SHARD'S OWN SETTINGS (shard.ts says what a shard is). RELAY_SHARDS is every shard's URL in
// shard order, the same list nm-fleet (FLEET_RELAY_URLS) and the hq gateway (HQ_RELAY_URL) hold.
// RELAY_SHARD_INDEX is this service's place in it. Each shard is its own Cloud Run service, so each
// one gets its own index in its own env.
import { parseRelayShards } from './shard.js';

export interface ShardConfig { index: number; urls: string[] }

/** null = the only relay (no list, or a list of one). A string = a setting that cannot run: a shard
 *  with a wrong index would refuse every machine it should serve, so the caller stops instead */
export function shardConfig(env: Record<string, string | undefined>): ShardConfig | null | string {
  const urls = parseRelayShards(env['RELAY_SHARDS']);
  if (urls.length <= 1) return null;
  const raw = env['RELAY_SHARD_INDEX']?.trim() ?? '';
  const index = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(index >= 0 && index < urls.length)) {
    return `RELAY_SHARDS names ${urls.length} shards, so RELAY_SHARD_INDEX must be 0 to ${urls.length - 1}, not ${JSON.stringify(raw)}`;
  }
  return { index, urls };
}

/** this shard's own URL in the form a fetch takes (the rollover watch asks it /revision) */
export function shardSelfUrl(c: ShardConfig): string | null {
  const own = c.urls[c.index];
  if (!own) return null;
  return own.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
}
