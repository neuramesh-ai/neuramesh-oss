// the balance as it fits inside the nav's credit ring (shell/CreditRing.tsx, 2026-09-17): a figure to
// glance at, never a price. Its own module so a node test can read it without pulling React in.
export function fmtCredits(n: number): string {
  const v = Math.max(0, Math.round(n));
  // from 9,950 up the tenth would round to "10.0k": say "10k". Below that, one decimal, computed on
  // an integer tenth so 9.95 never becomes "9.9" through toFixed's float
  if (v >= 9950) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${Math.round(v / 100) / 10}k`;
  return String(v);
}
