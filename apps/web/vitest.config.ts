import { defineConfig } from 'vitest/config';

// Unit tests target the analytics beacon's pure core (src/analytics.ts) — the only
// fire-and-forget code on the page, i.e. the only code whose failures are silent by
// design. No DOM needed: storage/fetch are injected.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
