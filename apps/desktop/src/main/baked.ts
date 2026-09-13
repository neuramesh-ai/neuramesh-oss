// THE BAKED CLOUD DEFAULTS — the last rung of URL precedence (connections.ts resolveUrls).
//
// A packaged build (NM_DIST=1) replaces these three DOT-ACCESS reads with literals at bundle time
// (electron.vite.config.ts bakedCloudConfig), because a double-clicked app inherits no shell
// environment. In a dev build the same reads see the real shell, which is the env rung anyway, so
// nothing changes hands twice. This is the ONE module that reads them with dot access; every other
// read of NM_API / NM_POWERSYNC / NM_WEB uses bracket access and means "the shell said so".
import type { ConnectionUrls } from './connections';

export const BAKED: ConnectionUrls = {
  apiUrl: process.env.NM_API ?? '',
  powersyncUrl: process.env.NM_POWERSYNC ?? '',
  webUrl: process.env.NM_WEB ?? 'https://neuramesh.app',
};
