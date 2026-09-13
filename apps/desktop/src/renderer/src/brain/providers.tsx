// The provider catalogue — who can run a turn, which runtime each maps to, and the marks
// (Anthropic sunburst · OpenAI knot · Gemini spark) that name them without an emoji.
// Split out of brain/brain.tsx.

import { type AgentRole, type Provider, type Runtime } from '@neuramesh/shared';
import { PorchMark } from '../brand';

/** what a mark can name: a real vendor, or the HOUSE — which is what the starter brain wears so
 *  the surface never claims a supplier we may change. */
export type ProviderMarkId = 'anthropic' | 'openai' | 'gemini' | 'neuramesh';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).


// Provider brand marks for the "Bring your own brain" cards — recognizable inline SVGs
// (Anthropic sunburst · OpenAI knot · Gemini spark) rather than generic emoji.
//
// THE HOUSE BRAIN WEARS THE HOUSE MARK (George, 2026-08-28). The starter model is served from our
// own key today and that WILL change — a mark naming this month's vendor is a promise about our
// supply chain that we never made and would have to un-tell. It is the same ruling the label
// already carries (`MODEL_LABELS` calls it "NeuraMesh Starter" rather than naming Google), and
// the two contradicting each other was the bug: the label hid the vendor while the logo beside it
// announced it.
//
// An UNKNOWN id gets the house mark too, which is a fix in its own right — this component used to
// fall through to the Gemini spark, so a model missing from the catalogue silently claimed to be
// Google's. A neutral mark is the honest answer to "we do not recognise this".
export function ProviderLogo({ id, s = 22 }: { id: ProviderMarkId; s?: number }) {
  if (id === 'anthropic') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
        {Array.from({ length: 12 }).map((_, i) => (
          <line key={i} x1="12" y1="12" x2="12" y2="2.7" stroke="#d97757" strokeWidth="2.05" strokeLinecap="round" transform={`rotate(${i * 30} 12 12)`} />
        ))}
      </svg>
    );
  }
  if (id === 'openai') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="var(--text)" aria-hidden>
        <path d="M21.55 10.04a5.42 5.42 0 0 0-.47-4.46 5.49 5.49 0 0 0-5.91-2.63A5.42 5.42 0 0 0 11.07 1.2a5.49 5.49 0 0 0-5.23 3.8 5.42 5.42 0 0 0-3.63 2.63 5.49 5.49 0 0 0 .68 6.43 5.42 5.42 0 0 0 .47 4.46 5.49 5.49 0 0 0 5.91 2.63 5.42 5.42 0 0 0 4.09 1.82 5.49 5.49 0 0 0 5.24-3.81 5.42 5.42 0 0 0 3.62-2.63 5.49 5.49 0 0 0-.68-6.42zm-8.2 11.49a4.07 4.07 0 0 1-2.61-.95l.13-.07 4.34-2.5a.7.7 0 0 0 .36-.62v-6.12l1.83 1.06.02.05v5.06a4.09 4.09 0 0 1-4.08 4.09zM4.59 18.02a4.07 4.07 0 0 1-.49-2.74l.13.08 4.34 2.5a.71.71 0 0 0 .71 0l5.3-3.06v2.12l-.03.06-4.39 2.53a4.09 4.09 0 0 1-5.58-1.49zM3.46 8.62a4.07 4.07 0 0 1 2.13-1.79v5.16a.7.7 0 0 0 .35.61l5.3 3.06-1.84 1.06-.06.01-4.38-2.53a4.09 4.09 0 0 1-1.5-5.58zm15.07 3.5l-5.3-3.06 1.83-1.06.06-.01 4.38 2.53a4.08 4.08 0 0 1-.62 7.37v-5.16a.7.7 0 0 0-.35-.61zm1.82-2.74l-.13-.08-4.34-2.51a.71.71 0 0 0-.71 0l-5.3 3.06V7.79l.03-.06 4.38-2.52a4.08 4.08 0 0 1 6.07 4.23zM9.69 13.15l-1.83-1.06-.02-.05V6.99a4.08 4.08 0 0 1 6.7-3.14l-.13.07-4.34 2.5a.7.7 0 0 0-.36.62l-.02 6.11zm1-2.15L13.05 9.6l2.36 1.36v2.73l-2.36 1.36-2.36-1.36z"/>
      </svg>
    );
  }
  if (id === 'gemini') {
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
        <defs>
          <linearGradient id="nm-gemini-grad" x1="2" y1="3" x2="22" y2="21" gradientUnits="userSpaceOnUse">
            <stop stopColor="#4285f4" /><stop offset="0.52" stopColor="#9168c0" /><stop offset="1" stopColor="#d96570" />
          </linearGradient>
        </defs>
        <path d="M12 1.6c.45 5.55 4.85 9.95 10.4 10.4-5.55.45-9.95 4.85-10.4 10.4-.45-5.55-4.85-9.95-10.4-10.4C7.15 11.55 11.55 7.15 12 1.6z" fill="url(#nm-gemini-grad)" />
      </svg>
    );
  }
  // the house, and the fallback: see the note above
  return <PorchMark size={s} title="NeuraMesh" />;
}

// "Bring your own brain": the three model providers, each reusable via subscription (their
// CLI's own login) or an API key. pkg = npm package to install the CLI; login = the command
// that signs that CLI into the subscription.
// which runtime's catalog each provider owns — the brain picker groups by provider and the
// catalog is keyed by runtime, so the mapping is written once here rather than inferred per row
export const PROVIDER_RUNTIME: ReadonlyArray<readonly [Provider, Runtime]> = [
  ['anthropic', 'claude-code'], ['openai', 'codex'], ['gemini', 'gemini'],
];

export const BRAIN_PROVIDERS: Array<{ id: 'anthropic' | 'openai' | 'gemini'; name: string; sub: string; place: string; pkg: string; login: string }> = [
  { id: 'anthropic', name: 'Claude', sub: 'Reuse your Claude Pro/Max plan', place: 'sk-ant-…', pkg: '@anthropic-ai/claude-code', login: 'claude' },
  { id: 'openai', name: 'ChatGPT', sub: 'Reuse your ChatGPT Plus/Pro plan', place: 'sk-…', pkg: '@openai/codex', login: 'codex login' },
  { id: 'gemini', name: 'Gemini', sub: 'Sign in with your Google account (Antigravity)', place: 'AIza… (API key)', pkg: 'antigravity-cli', login: 'agy' },
];

// role → identity dot for the brain pickers (sales has no role token — muted)
export const ROLE_DOT: Record<AgentRole, string> = {
  orchestrator: 'var(--role-orch)', architect: 'var(--role-arch)', developer: 'var(--role-dev)', worker: 'var(--role-dev)',
  reviewer: 'var(--role-rev)', designer: 'var(--role-design)', sales: 'var(--muted)', curator: 'var(--role-cur)',
  shipper: 'var(--role-ship)', marketer: 'var(--role-mkt)',
};
