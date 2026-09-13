/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Clerk publishable key — same instance as the desktop app. Web account creation
   *  hands off to Clerk's hosted sign-up when set; falls back to a demo when unset. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** PostHog publishable key (phc_*) — same project as the server activation funnel.
   *  Absent → the page beacon hard no-ops (vite.config warns loudly at prod build). */
  readonly VITE_PH_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
