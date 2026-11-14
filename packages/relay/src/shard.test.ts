// The shard rule (shard.ts). The vectors are the contract: nm-fleet stamps a pool by this function,
// the browser client dials by it and the hub refuses by it, and a change to any output below moves
// live machines to another shard. They were computed by an independent reimplementation (Python),
// not by this code. Change them only with a plan to move every machine.
import { describe, expect, it } from 'vitest';
import {
  parseRelayShards, parseWrongShard, shardIndexFor, shardScore, shardUrlFor, WRONG_SHARD_CLOSE, wrongShardReason, wrongShardTarget,
} from './shard.js';
import { CLOSE } from './protocol.js';
import { shardConfig, shardSelfUrl } from './shard-config.js';

/** [machine id, scores of shards 0..3, shard among 1, 2, 3 and 4 shards] */
const VECTORS: Array<[string, [number, number, number, number], [number, number, number, number]]> = [
  ['', [4070664416, 2063690019, 3457120986, 2010836140], [0, 0, 0, 0]],
  ['a', [3649009431, 171730747, 249264196, 223903749], [0, 0, 0, 0]],
  ['m-e2e', [451765561, 4185759850, 3350904539, 3202913512], [0, 1, 1, 1]],
  ['1a1a1a1a-0000-4000-8000-000000000001', [3358547897, 1408729430, 3190909210, 2303843538], [0, 0, 0, 0]],
  ['2b2b2b2b-0000-4000-8000-000000000002', [185842582, 1058379162, 400362038, 138871032], [0, 1, 1, 1]],
  ['0f0f0f0f-0000-4000-8000-000000000001', [441255344, 1445185548, 2997167278, 4294943827], [0, 1, 2, 3]],
  ['6f9619ff-8b86-d011-b42d-00c04fc964ff', [2368046846, 2272431866, 4243027654, 2199890646], [0, 0, 2, 2]],
  ['é-machine-✓', [3175891348, 2469884689, 939792987, 3810748398], [0, 0, 0, 3]],
];

/** a fixed spread of uuid-shaped ids (a small LCG, so the sample is the same on every run) */
function sampleIds(n: number): string[] {
  let x = 0x2545f491;
  const next = (): string => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return x.toString(16).padStart(8, '0'); };
  return Array.from({ length: n }, () => `${next()}-0000-4000-8000-${next()}${next().slice(0, 4)}`);
}

describe('the shard hash', () => {
  it('matches the pinned vectors: every score, and the shard among 1 to 4 shards', () => {
    for (const [id, scores, shards] of VECTORS) {
      expect([0, 1, 2, 3].map((i) => shardScore(id, i)), id).toEqual(scores);
      expect([1, 2, 3, 4].map((n) => shardIndexFor(id, n)), id).toEqual(shards);
    }
  });

  it('one shard, or none, is shard 0', () => {
    expect(shardIndexFor('anything', 1)).toBe(0);
    expect(shardIndexFor('anything', 0)).toBe(0);
    expect(shardIndexFor('anything', Number.NaN)).toBe(0);
  });

  it('splits machines evenly: every shard within 5 % of its fair share', () => {
    const ids = sampleIds(20_000);
    for (const n of [2, 3, 4, 8]) {
      const counts = new Array<number>(n).fill(0);
      for (const id of ids) counts[shardIndexFor(id, n)]! += 1;
      for (const c of counts) expect(Math.abs(c - ids.length / n) / (ids.length / n), `${n} shards: ${counts.join(' ')}`).toBeLessThan(0.05);
    }
  });

  it('adding a shard moves about 1/(N+1) of the machines, and each one moves to the new shard', () => {
    const ids = sampleIds(20_000);
    for (const n of [1, 2, 3, 7]) {
      const moved = ids.filter((id) => shardIndexFor(id, n) !== shardIndexFor(id, n + 1));
      expect(moved.every((id) => shardIndexFor(id, n + 1) === n), `${n} -> ${n + 1}`).toBe(true);
      expect(Math.abs(moved.length / ids.length - 1 / (n + 1)), `${n} -> ${n + 1}: ${moved.length}`).toBeLessThan(0.02);
    }
  });
});

describe('the shard list', () => {
  it('is a comma list in shard order: blanks and trailing slashes go, one URL is a list of one', () => {
    expect(parseRelayShards('wss://a/, wss://b ,, ')).toEqual(['wss://a', 'wss://b']);
    expect(parseRelayShards('wss://relay.neuramesh.app')).toEqual(['wss://relay.neuramesh.app']);
    expect(parseRelayShards('')).toEqual([]);
    expect(parseRelayShards(undefined)).toEqual([]);
    expect(parseRelayShards(['wss://x/', ' '])).toEqual(['wss://x']);
  });

  it('a machine dials its shard\'s entry, the only entry when there is one, and nothing when there is none', () => {
    const list = 'wss://r0,wss://r1,wss://r2,wss://r3';
    expect(shardUrlFor(list, '0f0f0f0f-0000-4000-8000-000000000001')).toBe('wss://r3');
    expect(shardUrlFor('wss://r0,wss://r1', 'm-e2e')).toBe('wss://r1');
    expect(shardUrlFor('wss://only/', 'm-e2e')).toBe('wss://only');
    expect(shardUrlFor('', 'm-e2e')).toBe('');
  });
});

describe('the wrong-shard refusal', () => {
  it('is close 4421 and names the shard and its URL, within a close frame\'s 123 bytes', () => {
    expect(CLOSE.WRONG_SHARD).toBe(4421);
    expect(WRONG_SHARD_CLOSE).toBe(4421);
    expect(wrongShardReason(1, 2, 'wss://nm-e2e-relay-1-aqnc7mc2lq-uk.a.run.app')).toBe('shard 1/2 wss://nm-e2e-relay-1-aqnc7mc2lq-uk.a.run.app');
    const long = `wss://${'x'.repeat(130)}.example`;
    expect(wrongShardReason(1, 2, long)).toBe('shard 1/2');
    expect(parseWrongShard('shard 1/2 wss://b')).toEqual({ index: 1, count: 2, url: 'wss://b' });
    expect(parseWrongShard('shard 1/2')).toEqual({ index: 1, count: 2, url: null });
    expect(parseWrongShard('shard 2/2')).toBeNull();
    expect(parseWrongShard('machine offline')).toBeNull();
  });

  it('sends a client to the named URL, else to entry k of a list as long as the relay\'s, never to plain ws from wss, never to the same URL', () => {
    expect(wrongShardTarget('shard 1/2 wss://b/', ['wss://a'], 'wss://a')).toBe('wss://b');
    expect(wrongShardTarget('shard 1/2', ['wss://a', 'wss://b'], 'wss://a')).toBe('wss://b');
    // a stale list of another length cannot say where shard 1 is
    expect(wrongShardTarget('shard 1/2', ['wss://a'], 'wss://a')).toBeNull();
    expect(wrongShardTarget('shard 1/2 ws://b', ['wss://a'], 'wss://a')).toBeNull();
    expect(wrongShardTarget('shard 1/2 wss://a/', ['wss://a'], 'wss://a')).toBeNull();
    expect(wrongShardTarget('shard 1/2 ws://127.0.0.1:9', [], 'ws://127.0.0.1:8')).toBe('ws://127.0.0.1:9');
    expect(wrongShardTarget('nonsense', ['wss://a', 'wss://b'], 'wss://a')).toBeNull();
  });
});

describe('a shard\'s own settings', () => {
  it('no list or a list of one is the only relay; a list needs an index inside it', () => {
    expect(shardConfig({})).toBeNull();
    expect(shardConfig({ RELAY_SHARDS: 'wss://a', RELAY_SHARD_INDEX: '3' })).toBeNull();
    expect(shardConfig({ RELAY_SHARDS: 'wss://a,wss://b', RELAY_SHARD_INDEX: '1' })).toEqual({ index: 1, urls: ['wss://a', 'wss://b'] });
    for (const bad of [undefined, '', '2', '-1', '1.5', 'one']) {
      expect(typeof shardConfig({ RELAY_SHARDS: 'wss://a,wss://b', ...(bad === undefined ? {} : { RELAY_SHARD_INDEX: bad }) }), String(bad)).toBe('string');
    }
  });

  it('its own URL, for the rollover watch, is its entry in fetch form', () => {
    expect(shardSelfUrl({ index: 1, urls: ['wss://a', 'wss://b.run.app'] })).toBe('https://b.run.app');
    expect(shardSelfUrl({ index: 0, urls: ['ws://127.0.0.1:1', 'ws://x'] })).toBe('http://127.0.0.1:1');
  });
});
