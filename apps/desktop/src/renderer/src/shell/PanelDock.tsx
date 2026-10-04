// THE SIDE PANEL's column and its grip (2026-08-16; generalised in the rail-ink round 3, 2026-09-04;
// the Workbench card that shared it retired on 2026-10-03, the side-panel round).
//
// The grip is the split stage's idiom (the nav edge · here): invisible at rest, a 3px pill on hover,
// `--ring` plus a live px readout while dragging, double-click resets, arrow keys nudge. Direct
// manipulation, so `data-dragging` kills the width transition while the pointer is down.
//
// Geometry only: where the column is, how wide, which way the drag runs. The panel mirrors with the
// shell's `row-reverse`, so only its drag direction inverts.
import type { ReactNode } from 'react';

export function PanelDock({ width, min, max, mirrored, dragging, onWidth, onReset, onDragging, children, expanded = false }: {
  width: number;
  min: number;
  max: number;
  /** the shell is docked right, so the column is on the far side and the drag runs the other way */
  mirrored: boolean;
  dragging: boolean;
  onWidth: (px: number) => void;
  onReset: () => void;
  onDragging: (on: boolean) => void;
  children: ReactNode;
  /** the panel covers the main area for a deep review (the card's old expand, moved here) */
  expanded?: boolean;
}) {
  const dir = mirrored ? 1 : -1;
  return (
    <>
      {!expanded && (
        <div
          className="wbgrip sdgrip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the side panel"
          aria-valuenow={width}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          data-tip="Drag to resize · double-click resets"
          onPointerDown={(e) => {
            e.preventDefault();
            const el = e.currentTarget;
            const x0 = e.clientX, w0 = width;
            onDragging(true);
            el.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) => onWidth(w0 + dir * (ev.clientX - x0));
            const up = () => {
              onDragging(false);
              el.removeEventListener('pointermove', move);
              el.removeEventListener('pointerup', up);
              el.removeEventListener('pointercancel', up);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
            el.addEventListener('pointercancel', up);
          }}
          onDoubleClick={onReset}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); onWidth(width - 12 * dir); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); onWidth(width + 12 * dir); }
          }}
        >
          <span className="wbgripbar" aria-hidden />
          {dragging && <span className="wbgripout" aria-hidden>{width}px</span>}
        </div>
      )}
      <div className={`sidedock${expanded ? ' expanded' : ''}`} data-dragging={dragging ? '1' : undefined} style={{ '--nm-dockw': `${width}px` } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
