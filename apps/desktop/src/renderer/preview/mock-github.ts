// THE GITHUB CONNECTOR in the harness (docs/design/github-connector-2026-09, the pick round §7):
// `?github=` seeds the face: `pick` = the App reads three repositories for the workspace (the folder's
// namesake first), `one` = it reads one, default = nothing readable (the grant). Connect "finishes on
// GitHub" after a beat so a shot captures both faces, the pick attaches on the spot. Kept apart from
// mock-nm.ts (at its size cap) and spread into it; the entries are runtime keys, so the drift guard
// still counts them.
type Conn = { id: string; provider: string; handle: string; status: string };
const seed = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('github') : null;
const READABLE = seed === 'pick' ? ['alonge-dev/flowe-mobile', 'alonge-dev/neuramesh', 'flowe-ai/site'] : seed === 'one' ? ['alonge-dev/flowe-mobile'] : [];

export function githubLanes(mockConnectors: Conn[]) {
  return {
    // connectors: Connect "completes the external OAuth" after a beat so shots capture both states
    connectorStart: async (_channelId: string, provider?: string) => {
      const row = provider === 'github'
        ? { id: 'conn-gh', provider: 'github', handle: 'acme/marketing-site', status: 'connected' }
        : { id: 'conn-x', provider: 'x', handle: '@_neuramesh', status: 'connected' };
      // a seeded pick stays on the pick: the grant's page is GitHub's, the shot is of the step
      if (provider !== 'github' || !READABLE.length) setTimeout(() => { mockConnectors.push(row); }, 800);
      return { ok: true };
    },
    githubResolve: async (_channelId: string, repo?: string) => {
      if (repo) {
        if (!READABLE.includes(repo)) return { ok: false as const, code: 'NOT_INSTALLED' as const, error: `The neuramesh app cannot read ${repo}. Add the repository on GitHub, then pick it.`, repos: READABLE, hint: null };
        mockConnectors.push({ id: 'conn-gh', provider: 'github', handle: repo, status: 'connected' });
        return { ok: true as const, handle: repo, attached: true };
      }
      const row = mockConnectors.find((c) => c.provider === 'github' && c.status === 'connected');
      if (row) return { ok: true as const, handle: row.handle, attached: false };
      return READABLE.length
        ? { ok: false as const, code: 'NO_REPO' as const, error: 'Pick the repository flowe-mobile lives in.', install: 'https://github.com/apps/neuramesh/installations/new', repos: READABLE, hint: 'alonge-dev/flowe-mobile' }
        : { ok: false as const, code: 'NO_REPO' as const, error: 'flowe-mobile is a folder on a machine. Grant access on GitHub and pick its repository there.', install: 'https://github.com/apps/neuramesh/installations/new', repos: [], hint: null };
    },
  };
}
