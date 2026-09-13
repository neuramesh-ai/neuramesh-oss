import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import {
  ENGINEERING_COMPOSER_WIDTH_DEFAULT,
  ENGINEERING_COMPOSER_WIDTH_KEY,
  ENGINEERING_COMPOSER_WIDTH_MIN,
  clampEngineeringComposerWidth,
  loadEngineeringComposerWidth,
} from './layout';

function publishEngineeringComposerWidth(workspace: HTMLDivElement | null, width: number) {
  workspace?.closest<HTMLElement>('.main')?.style.setProperty('--eng-composer-width', `${width}px`);
}

export function useEngineeringComposerResize(workspaceRef: RefObject<HTMLDivElement | null>) {
  const widthRef = useRef(loadEngineeringComposerWidth());
  const [width, setWidth] = useState(widthRef.current);
  const [maximum, setMaximum] = useState(ENGINEERING_COMPOSER_WIDTH_MIN);
  const [resizing, setResizing] = useState(false);

  const remember = (next: number) => {
    widthRef.current = next;
    setWidth(next);
    publishEngineeringComposerWidth(workspaceRef.current, next);
    try { localStorage.setItem(ENGINEERING_COMPOSER_WIDTH_KEY, String(next)); } catch { /* private mode */ }
  };

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace || typeof ResizeObserver === 'undefined') return;
    const fit = () => {
      const next = clampEngineeringComposerWidth(widthRef.current, workspace.clientWidth);
      widthRef.current = next;
      setWidth(next);
      publishEngineeringComposerWidth(workspace, next);
      setMaximum(clampEngineeringComposerWidth(workspace.clientWidth, workspace.clientWidth));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(workspace);
    return () => {
      observer.disconnect();
      workspace.closest<HTMLElement>('.main')?.style.removeProperty('--eng-composer-width');
    };
  }, [workspaceRef]);

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    setResizing(true);
    const update = (next: PointerEvent) => {
      const rect = workspace.getBoundingClientRect();
      const nextWidth = clampEngineeringComposerWidth(next.clientX - rect.left, workspace.clientWidth);
      widthRef.current = nextWidth;
      setWidth(nextWidth);
      publishEngineeringComposerWidth(workspace, nextWidth);
    };
    const finish = () => {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', update);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      setResizing(false);
      remember(widthRef.current);
    };
    handle.addEventListener('pointermove', update);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  const resizeBy = (delta: number) => {
    const workspace = workspaceRef.current;
    if (workspace) remember(clampEngineeringComposerWidth(widthRef.current + delta, workspace.clientWidth));
  };
  const resizeTo = (next: number) => {
    const workspaceWidth = workspaceRef.current?.clientWidth ?? 900;
    remember(clampEngineeringComposerWidth(next, workspaceWidth));
  };
  return { width, maximum, resizing, begin, resizeBy, resizeTo };
}

export function EngineeringComposerSplitter({ width, maximum, resizing, begin, resizeBy, resizeTo }: ReturnType<typeof useEngineeringComposerResize>) {
  return (
    <div className="engsplitter" role="separator" aria-label="Resize Code conversation" aria-orientation="vertical"
      aria-valuenow={width} aria-valuemin={ENGINEERING_COMPOSER_WIDTH_MIN} aria-valuemax={maximum}
      title="Drag to resize · double-click to reset"
      tabIndex={0} onPointerDown={begin} onDoubleClick={() => resizeTo(ENGINEERING_COMPOSER_WIDTH_DEFAULT)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); resizeBy(-12); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); resizeBy(12); }
        else if (event.key === 'Home') { event.preventDefault(); resizeTo(ENGINEERING_COMPOSER_WIDTH_MIN); }
      }}>
      <span className="engsplitterbar" aria-hidden />
      {resizing ? <span className="engsplitterout" aria-hidden>{width}px</span> : null}
    </div>
  );
}
