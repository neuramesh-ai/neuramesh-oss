// A textarea that grows with its content — extracted from App.tsx (track A3).
import { useLayoutEffect, useRef } from 'react';

// Auto-growing composer textarea: starts at one line, grows with content up to `maxRows`,
// then scrolls. Enter-to-send / Shift+Enter-newline is owned by the caller's onKeyDown —
// ComposerInput below wraps this with the shared mention/slash behavior for BOTH composers.
// Height is recomputed on every value change — including external setDraft (intro draft,
// clear-on-send) — so it never lags.
export function AutoTextarea({
  value,
  onChange,
  maxRows = 8,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  maxRows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const max = Math.round(line * maxRows + pad + border);
    const next = Math.min(el.scrollHeight, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, maxRows]);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
