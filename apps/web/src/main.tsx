import { createRoot } from 'react-dom/client';
import '@neuramesh/fonts/neuramesh-sans.css';
import '@fontsource-variable/geist-mono/wght.css';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './styles.css';
import { App } from './App';

// Opt into scroll-reveal's hidden-init state BEFORE first paint (no visible→hidden flash),
// and only when motion is welcome + IntersectionObserver can drive the reveal. Everywhere
// else (reduced motion, no IO) content simply renders visible. The reveal hook adds `.in`.
try {
  if (typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('rvl');
  }
} catch { /* keep content visible on any failure */ }

createRoot(document.getElementById('root')!).render(<App />);
