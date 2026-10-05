// the credential read the Code chip shares with the browser client's model surfaces (apps/hq models/hooks.ts):
// which providers the workspace set up, and which of them it set up with an API key. The desktop's main
// composers keep the brain pill, so the web's picks read (useMyModels) stays on the web: this bridge has no
// setAgentModel lane.
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';

const nm = nmBridge;
// the credential list, kept across mounts: a chip that mounts reads the last answer at once
type CredentialSets = { configured: ReadonlySet<string>; keyed: ReadonlySet<string> };
let lastSets: CredentialSets = { configured: new Set(), keyed: new Set() };

/** the providers with a credential in this workspace (the Keys and Connections answer), and the ones whose
 *  workspace credential is an API key (a cloud machine serves those, localruntimes.ts machineRuntimes) */
export function useCredentialSets(): CredentialSets {
  const [sets, setSets] = useState<CredentialSets>(lastSets);
  useEffect(() => {
    let live = true;
    void nm?.credentials().then((r: { credentials: Array<{ provider: string; scope?: string; authMode?: string }> }) => {
      const rows = r.credentials ?? [];
      lastSets = { configured: new Set(rows.map((c) => c.provider)), keyed: new Set(rows.filter((c) => c.scope === 'workspace' && c.authMode === 'apikey').map((c) => c.provider)) };
      if (live) setSets(lastSets);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  return sets;
}
