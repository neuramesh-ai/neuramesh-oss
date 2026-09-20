// THE CONNECTOR REGISTRY + the one derivation of "is it connected" (the composer-foot round,
// 2026-09-11; docs/design/composer-foot-2026-09). The room's Connections list and the composer
// foot's marks both read `connectorStates`, so a surface can never say "connected" about a row
// the other calls "Connect" — the one-derivation rule (docs/33 §8, the bell's count).
//
// Four kinds, four truths: an OAuth connector is a workspace-wide `connectors` row (keyed
// workspace + provider); a key connector is a MACHINE-LOCAL MCP key plus the room's own
// integration flag (`marketing.mcp`), so its verdict is per room; the image model is a
// workspace credential (`<provider>-image`, never the agents' seat); an APP connector (GitHub,
// docs/design/github-connector-2026-09) is a `connectors` row too, but the grant behind it is the
// platform's GitHub App installation, so there is no secret to seal and no token on any machine.
import type { ConnectorRow } from '../bridge/rows-content';
import type { CredRow } from '../bridge/rows-infra';

export type ConnectorId = 'x' | 'linkedin' | 'instagram' | 'tiktok' | 'github' | 'posthog' | 'meta' | 'tiktokads' | 'images';
export type ConnectorKind = 'oauth' | 'app' | 'key' | 'image';
export interface ConnectorDef {
  id: ConnectorId;
  label: string;
  kind: ConnectorKind;
  /** the `connectors.provider` value (oauth, app) or the MCP presence key (key); '' for the image model */
  provider: string;
}

/** FIXED order, never sorted by state (the setup tracker's ruling: order is the argument) */
export const CONNECTORS: readonly ConnectorDef[] = [
  { id: 'x', label: 'X', kind: 'oauth', provider: 'x' },
  { id: 'linkedin', label: 'LinkedIn', kind: 'oauth', provider: 'linkedin' },
  { id: 'instagram', label: 'Instagram', kind: 'oauth', provider: 'instagram' },
  { id: 'tiktok', label: 'TikTok', kind: 'oauth', provider: 'tiktok' },
  // what you publish to, then what you read from, then the keys, then the image model
  { id: 'github', label: 'GitHub', kind: 'app', provider: 'github' },
  { id: 'posthog', label: 'PostHog', kind: 'key', provider: 'posthog' },
  { id: 'meta', label: 'Meta Ads', kind: 'key', provider: 'meta' },
  { id: 'tiktokads', label: 'TikTok Ads', kind: 'key', provider: 'tiktok' },
  { id: 'images', label: 'Image generation', kind: 'image', provider: '' },
];

/** the marks the composer foot draws; the rest live behind ⋯. Four, not eight: at the stage's
 *  640px measure the three suggestion pills and eight 24px targets do not share one line. */
export const FOOT_MARKS: readonly ConnectorId[] = ['x', 'linkedin', 'instagram', 'tiktok'];

export interface ConnectorState extends ConnectorDef {
  connected: boolean;
  /** the account (or the image key's provider + last4), when connected */
  handle: string | null;
  /** a dead grant that still names an account: the honest verb is Reconnect, not a bare Connect.
   *  'reauth_required' is the server's own verdict (0121), 'revoked' the human's deliberate off. */
  dead: ConnectorRow | null;
  /** the live OAuth row, the disconnect target */
  conn: ConnectorRow | null;
}

// Which stored key can draw a picture. A DEDICATED `<provider>-image` credential wins, so setting
// one for images never disturbs how agents authenticate; a plain provider API key still works
// (if you already gave your agents one, images just run on it).
export const IMAGE_CRED_ORDER = ['openai-image', 'gemini-image', 'openai', 'gemini'];
export function imageCredOf(creds: CredRow[]): CredRow | undefined {
  for (const p of IMAGE_CRED_ORDER) {
    const hit = creds.find((c) => c.provider === p && c.authMode === 'apikey');
    if (hit) return hit;
  }
  return undefined;
}

/** the room's armed integrations, from its `marketing` JSON profile */
export function mcpFlagsOf(marketing: string | null | undefined): Record<string, boolean> {
  try { return (JSON.parse(marketing ?? '{}') as { mcp?: Record<string, boolean> }).mcp ?? {}; } catch { return {}; }
}

export function connectorStates(input: {
  conns: ConnectorRow[];
  presence: Partial<Record<string, boolean>>;
  mcp: Record<string, boolean>;
  creds: CredRow[];
}): ConnectorState[] {
  return CONNECTORS.map((d) => {
    if (d.kind === 'oauth' || d.kind === 'app') {
      const live = input.conns.find((c) => c.provider === d.provider && c.status === 'connected') ?? null;
      const dead = live ? null : input.conns.find((c) => c.provider === d.provider && (c.status === 'revoked' || c.status === 'reauth_required') && !!c.handle) ?? null;
      return { ...d, connected: !!live, handle: live?.handle || null, dead, conn: live };
    }
    if (d.kind === 'key') {
      return { ...d, connected: !!input.presence[d.provider] && !!input.mcp[d.provider], handle: null, dead: null, conn: null };
    }
    const img = imageCredOf(input.creds);
    return { ...d, connected: !!img, handle: img ? `${img.provider.replace('-image', '')}${img.last4 ? ` ····${img.last4}` : ''}` : null, dead: null, conn: null };
  });
}
