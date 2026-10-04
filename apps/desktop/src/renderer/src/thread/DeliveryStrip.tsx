// The delivery strip (docs/30) — what a run delivered, named in the thread. Since the side-panel
// round (2026-10-03) each file is ONE ROW: the file itself opens in the side panel by itself as it
// lands, and a click on its row shows it again. The inline previews that drew the same file beside
// the panel retired on the web (thread/FileBody.tsx is now the panel's reader for the rich kinds).
import { IconCode, IconFile, IconImage } from '../ui/icons';
import { fileTag, fileWeight } from '@neuramesh/shared';
import { type ArtifactUI } from '../bridge/rows-board';
import { RefCard, usePanelShown } from './RefCard';

const glyphFor = (a: ArtifactUI) => {
  const tag = fileTag(a.name, a.kind);
  if (a.kind === 'screenshot' || /^(png|jpe?g|gif|webp|svg)$/.test(tag)) return <IconImage s={14} />;
  if (a.kind === 'diff' || /^(diff|patch)$/.test(tag)) return <IconCode s={14} />;
  return <IconFile s={14} />;
};

/** One submit's files: a row each, under one head. */
export function DeliveryStrip({ arts, superseded, onOpen }: { arts: ArtifactUI[]; superseded: Set<string>; onOpen: (name: string) => void }) {
  const shown = usePanelShown();
  if (!arts.length) return null;
  return (
    <div className="delivery">
      <div className="deliveryhead">{arts.length === 1 ? 'Delivered' : `Delivered · ${arts.length} files`}</div>
      <div className="refrows">
        {arts.map((a) => (
          <RefCard key={a.id} glyph={glyphFor(a)} name={a.name} shown={shown.name === a.name} onOpen={() => onOpen(a.name)}
            meta={[fileTag(a.name, a.kind), fileWeight(a.name, a.kind, a.inline_content), superseded.has(a.id) ? 'replaced' : ''].filter(Boolean).join(' · ')} />
        ))}
      </div>
    </div>
  );
}

// The Calendar surface (marketing-channel plan §4.7, mockup scene 05): platform rows ×
// days; a chip is a content item, never a task. Drafts are dashed (no clock yet),
// scheduled are solid with their time, published are green with the receipt. Click →
// preview popover with the human gates (Approve · Unschedule); approve puts it on the
// clock server-side (HUMAN_ONLY), publishing lands with connectors.
export const MK_PLATFORMS: Array<[string, string]> = [['x', 'X'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['email', 'Email']];

export const MK_PLATFORM_ICON: Record<string, string> = { x: '𝕏', instagram: '◫', linkedin: 'in', tiktok: '♪', email: '✉' };
