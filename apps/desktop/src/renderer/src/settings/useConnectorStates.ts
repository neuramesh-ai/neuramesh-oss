// The three reads behind every connector verdict, polled the ConnectionsList way: every 5s while a
// connect step is open (mid-OAuth, the row must flip the moment the browser tab finishes), else
// every 30s — and on window focus, because an OAuth finishes in the browser and the human comes
// BACK to this window. A bridge without a method (the browser client keeps MCP keys unwired) must
// not blank the surface: each read is optional, and a failed read keeps the last truth.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import type { ConnectorRow } from '../bridge/rows-content';
import type { CredRow } from '../bridge/rows-infra';
import { connectorStates, mcpFlagsOf, type ConnectorState } from './connectors';

const nm = nmBridge;

export function useConnectorStates(channelId: string | null, marketing: string | null | undefined, live = false): { states: ConnectorState[]; refresh: () => void } {
  const [conns, setConns] = useState<ConnectorRow[]>([]);
  const [presence, setPresence] = useState<Partial<Record<string, boolean>>>({});
  const [creds, setCreds] = useState<CredRow[]>([]);
  const refresh = useCallback(() => {
    if (!channelId) return;
    void nm?.connectors?.(channelId).then((r) => setConns(r?.connectors ?? [])).catch(() => {});
    void nm?.mcpKeys?.().then((r) => { if (r?.presence) setPresence(r.presence); }).catch(() => {});
    void nm?.credentials?.().then((r) => setCreds(r?.credentials ?? [])).catch(() => {});
  }, [channelId]);
  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, live ? 5000 : 30_000);
    window.addEventListener('focus', refresh);
    return () => { clearInterval(iv); window.removeEventListener('focus', refresh); };
  }, [refresh, live]);
  const states = useMemo(() => connectorStates({ conns, presence, mcp: mcpFlagsOf(marketing), creds }), [conns, presence, marketing, creds]);
  return { states, refresh };
}
