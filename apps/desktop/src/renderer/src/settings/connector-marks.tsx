// The mark for a connector id — one lookup shared by the composer foot and the Connections rows,
// so a connector can never wear two different faces on two surfaces.
import type { ReactNode } from 'react';
import { IconImage, IconInstagram, IconLinkedIn, IconMeta, IconPostHog, IconTikTok, IconTikTokAds, IconX } from '../ui/icons';
import type { ConnectorId } from './connectors';

const MARK: Record<ConnectorId, (s: number) => ReactNode> = {
  x: (s) => <IconX s={s} />,
  linkedin: (s) => <IconLinkedIn s={s} />,
  instagram: (s) => <IconInstagram s={s} />,
  tiktok: (s) => <IconTikTok s={s} />,
  posthog: (s) => <IconPostHog s={s} />,
  meta: (s) => <IconMeta s={s} />,
  tiktokads: (s) => <IconTikTokAds s={s} />,
  images: (s) => <IconImage s={s} />,
};

export function ConnectorMark({ id, s }: { id: ConnectorId; s: number }) {
  return <>{MARK[id](s)}</>;
}
