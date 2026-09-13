import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// NeuraMesh marketing site (React + Vite SPA). base:'./' → relative asset paths so the
// build deploys to any static host (and opens over file:// for screenshot capture).
export default defineConfig(({ mode }) => {
  // The analytics beacon hard no-ops without a key AT RUNTIME (silent by contract), so the
  // only place a missing key is allowed to be loud is here, at build time — otherwise the
  // launch demand experiment can ship recording nothing and nobody notices. loadEnv (not
  // bare process.env) so a key supplied via .env files doesn't make the guard cry wolf —
  // the client bundle reads those files, and this check must see exactly what the bundle sees.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (mode === 'production' && !env.VITE_PH_KEY) {
    console.warn('\n⚠⚠⚠  VITE_PH_KEY is not set — this production build ships with page analytics DISABLED.');
    console.warn('⚠⚠⚠  The launch demand experiment will record nothing from the web side.');
    console.warn('⚠⚠⚠  Set VITE_PH_KEY in the Vercel project env (same PostHog project as the server funnel).\n');
  }
  return {
    plugins: [react()],
    // '/' in production: relative base ('./') resolves assets AGAINST THE ROUTE PATH, so any
    // multi-segment route served by the SPA catch-all (/billing/success et al — where Stripe
    // returns real customers) requested ./assets/* as /billing/assets/* → 404 → blank page
    // (verified live pre-fix). './' stays for non-prod so file:// screenshot capture keeps working.
    base: mode === 'production' ? '/' : './',
  };
});
