// A DOCKED COLUMN and its grip (2026-08-16; generalised in the rail-ink round 3, 2026-09-04).
//
// Two tenants share this geometry: the WORKBENCH CARD, which floats inside the sheet at its right
// edge beside the conversation, and the SIDE DOCK, the tab strip's own column at the frame's
// right edge where the Workbench used to dock. The grip is the split stage's idiom (nav edge ·
// task peek · here): invisible at rest, a 3px pill on hover, `--ring` plus a live px readout while
// dragging, double-click resets, arrow keys nudge. Direct manipulation, so `data-dragging` kills
// the width transition while the pointer is down.
//
// Geometry only — where the column is, how wide, which way the drag runs. The card never mirrors
// (it sits at the sheet's right whatever side the nav docks on); the side dock mirrors with the
// shell's `row-reverse`, so only its drag direction inverts.
import type { ReactNode } from 'react';

export function WorkbenchDock({ width, min, max, mirrored, dragging, onWidth, onReset, onDragging, children, variant = 'card' }: {
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
  /** the Workbench card inside the sheet (`--nm-panew`), or the side dock on the frame (`--nm-dockw`) */
  variant?: 'card' | 'side';
}) {
  const side = variant === 'side';
  const dir = side && mirrored ? 1 : -1;
  return (
    <>
      <div
        className={`wbgrip${side ? ' sdgrip' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={side ? 'Resize the side panel' : 'Resize the Workbench'}
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
      <div className={side ? 'sidedock' : 'wbdock'} data-dragging={dragging ? '1' : undefined} style={{ [side ? '--nm-dockw' : '--nm-panew']: `${width}px` } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
