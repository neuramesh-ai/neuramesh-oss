// THE FINANCE DESKTOP RELEASE (George, 2026-11-13; docs/design/oss-private-seam-2026-11/plan.md).
// Finance runs on the hosted side now and reaches the desktop app later, on its own release. Until
// then only a build with NM_DESKTOP_FINANCE=1 carries it (electron.vite.config.ts defines the
// constant for main, preload and renderer). tsx, the tests and `pnpm dist` see no define, so Finance
// stays off there. The cloud machine's Finance worker (machined.ts) does not read this flag.
declare const __NM_DESKTOP_FINANCE__: boolean | undefined;
export const DESKTOP_FINANCE: boolean = typeof __NM_DESKTOP_FINANCE__ !== 'undefined' && __NM_DESKTOP_FINANCE__ === true;
