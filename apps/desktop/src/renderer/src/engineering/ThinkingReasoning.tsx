import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import styles from './ThinkingReasoning.module.css';

/**
 * Data-driven adaptation of AI CSS' MIT-licensed Thinking + Reasoning component.
 * Source: https://www.aicss.dev/components/thinking-reasoning
 *
 * AI CSS' public demo owns sample sentences and presentation timers. NeuraMesh instead
 * supplies authoritative relay content, streaming state, and elapsed time so this primitive
 * can be reused anywhere in the Code UI without inventing model activity in the browser.
 */
export interface ThinkingReasoningProps {
  children: ReactNode;
  thinking: boolean;
  elapsedSeconds?: number | null;
  collapseWhenDone?: boolean;
  ariaLabel?: string;
}

const MAX_VIEWPORT_HEIGHT = 180;

export function ThinkingReasoning({
  children,
  thinking,
  elapsedSeconds,
  collapseWhenDone = true,
  ariaLabel = 'Toggle thought',
}: ThinkingReasoningProps) {
  const [open, setOpen] = useState(thinking || !collapseWhenDone);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const viewportRef = useRef<HTMLDivElement>(null);
  const regionId = useId();
  const expanded = thinking || open;

  useEffect(() => {
    if (thinking) setOpen(true);
    else if (collapseWhenDone) setOpen(false);
  }, [collapseWhenDone, thinking]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(() => {
      const nextHeight = Math.min(viewport.scrollHeight, MAX_VIEWPORT_HEIGHT);
      setViewportHeight(nextHeight);
      if (thinking) viewport.scrollTop = viewport.scrollHeight;
      setFade({
        top: viewport.scrollTop > 1,
        bottom: viewport.scrollTop + nextHeight < viewport.scrollHeight - 1,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [children, expanded, thinking]);

  const onScroll = () => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setFade({
      top: viewport.scrollTop > 1,
      bottom: viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1,
    });
  };

  const capped = viewportHeight >= MAX_VIEWPORT_HEIGHT;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${fade.top ? 16 : 0}px, #000 calc(100% - ${fade.bottom ? 16 : 0}px), transparent 100%)`
    : 'none';
  const duration = elapsedSeconds && elapsedSeconds > 0 ? ` for ${elapsedSeconds}s` : '';

  return (
    <section className={styles.tr} data-thinking={thinking || undefined}>
      <button
        type="button"
        className={`${styles.trHeader}${thinking ? '' : ` ${styles.isClickable}`}`}
        aria-expanded={expanded}
        aria-controls={regionId}
        aria-label={ariaLabel}
        aria-disabled={thinking || undefined}
        onClick={thinking ? undefined : () => setOpen((value) => !value)}
      >
        {thinking ? (
          <span className={`${styles.trLabel} ${styles.trShimmer}`}>Thinking…</span>
        ) : (
          <span className={styles.trLabel}><span className={styles.trVerb}>Thought</span>{duration}</span>
        )}
        {!thinking ? (
          <svg className={styles.trChevron} viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
            <path d="m4.5 15.75 7.5-7.5 7.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : null}
      </button>

      <div className={`${styles.trCollapsible}${expanded ? '' : ` ${styles.isCollapsed}`}`}>
        <div className={styles.trInner}>
          <div
            ref={viewportRef}
            id={regionId}
            className={`${styles.trViewport}${!thinking && open ? ` ${styles.isScroll}` : ''}`}
            style={{ height: `${viewportHeight}px`, WebkitMaskImage: mask, maskImage: mask }}
            onScroll={!thinking && open ? onScroll : undefined}
            aria-live={thinking ? 'polite' : 'off'}
            aria-atomic="false"
          >
            <div className={styles.trStream}>{children}</div>
          </div>
        </div>
      </div>
    </section>
  );
}
