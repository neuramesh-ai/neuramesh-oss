// Statistics for turning noisy repeated runs into defensible numbers.

/** Wilson score interval for a binomial proportion — well-behaved at the extremes (0/1). */
export function wilson(successes: number, n: number, z = 1.96): { p: number; lo: number; hi: number } {
  if (n === 0) return { p: 0, lo: 0, hi: 0 };
  const phat = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = phat + z2 / (2 * n);
  const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
  return { p: phat, lo: Math.max(0, (centre - margin) / denom), hi: Math.min(1, (centre + margin) / denom) };
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Min–max normalize to 0..100 across a field; invert when lower is better. */
export function normalize(vals: number[], invert = false): number[] {
  if (vals.length === 0) return [];
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  if (max === min) return vals.map(() => 100);
  return vals.map((v) => {
    const t = (v - min) / (max - min);
    return Math.round((invert ? 1 - t : t) * 100);
  });
}

/** Mean with a 95% CI (mean ± 1.96·SEM), clamped to [0,100] — for continuous rubric scores. */
export function meanCI(xs: number[]): { mean: number; lo: number; hi: number } {
  const n = xs.length;
  if (!n) return { mean: 0, lo: 0, hi: 0 };
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const v = n > 1 ? xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1) : 0;
  const sem = Math.sqrt(v / n);
  return { mean: m, lo: Math.max(0, m - 1.96 * sem), hi: Math.min(100, m + 1.96 * sem) };
}

export interface ValueWeights {
  quality: number;
  cost: number;
  speed: number;
}

/** Blend already-normalized (0..100) quality, inverse-cost, inverse-speed by weight. */
export function valueScore(qNorm: number, costInvNorm: number, speedInvNorm: number, w: ValueWeights): number {
  const total = w.quality + w.cost + w.speed || 1;
  return Math.round((w.quality * qNorm + w.cost * costInvNorm + w.speed * speedInvNorm) / total);
}
