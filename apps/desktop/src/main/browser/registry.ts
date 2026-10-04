// the machine's browser service, when this process has one. machined.ts sets it on a cloud machine
// whose image carries Chromium. the tool registries ask here, so a turn on the desktop app, or on a
// machine from before the browser, never offers a web_* tool it cannot run (a tool that only ever
// answers "unavailable" teaches the model to distrust its toolset, harness/toolbus.ts).
import type { BrowserService } from './service';

let current: BrowserService | null = null;

export const setBrowserService = (svc: BrowserService | null): void => { current = svc; };
export const browserService = (): BrowserService | null => current;
