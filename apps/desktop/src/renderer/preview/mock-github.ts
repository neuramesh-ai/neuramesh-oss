// THE GITHUB CONNECTOR in the harness (docs/design/github-connector-2026-09): Connect "finishes on
// GitHub" after a beat so a shot captures both faces, and the resolve says "not installed" until the
// row above exists. Kept apart from mock-nm.ts (at its size cap) and spread into it; the entries are
// runtime keys, so the drift guard still counts them.
type Conn = { id: string; provider: string; handle: string; status: string };

export function githubLanes(mockConnectors: Conn[]) {
  return {
    // connectors: Connect "completes the external OAuth" after a beat so shots capture both states
    connectorStart: async (_channelId: string, provider?: string) => {
      const row = provider === 'github'
        ? { id: 'conn-gh', provider: 'github', handle: 'acme/marketing-site', status: 'connected' }
        : { id: 'conn-x', provider: 'x', handle: '@_neuramesh', status: 'connected' };
      setTimeout(() => { mockConnectors.push(row); }, 800);
      return { ok: true };
    },
    githubResolve: async () => {
      const row = mockConnectors.find((c) => c.provider === 'github' && c.status === 'connected');
      return row
        ? { ok: true as const, handle: row.handle }
        : { ok: false as const, code: 'NOT_INSTALLED' as const, error: 'the neuramesh app is not installed on acme/marketing-site', install: 'https://github.com/apps/neuramesh/installations/new' };
    },
  };
}
