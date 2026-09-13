// The preview's shell, keyed to the foreground connection — the same remount renderer/main.tsx does,
// so a swap onto the other connection (U3b) is measurable in the harness: the click's timestamp
// crosses the remount in sessionStorage and the new shell prints `rail_swap` once it names the
// workspace. Beside main.tsx, which sits at the size bar.
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export function mountShell(App: ComponentType, mockNm: { onForeground: (cb: (c: { id: string }) => void) => () => void }, before: ReactNode): void {
  function Shell() {
    const [epoch, setEpoch] = useState(0);
    useEffect(() => mockNm.onForeground((c) => { console.log(`[preview] foreground_remount to=${c.id}`); setEpoch((e) => e + 1); }), []);
    return <App key={epoch} />;
  }
  createRoot(document.getElementById('root')!).render(<>{before}<Shell /></>);
}
