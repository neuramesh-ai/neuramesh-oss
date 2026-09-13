// The mark, the wordmark and every inline glyph — extracted from App.tsx (track D-web).


// ── Porch — the neuramesh mark (brand handoff; mirrors the app's brand.tsx). The
// mark keeps literal oak/cream in BOTH site modes — identity is theme-independent.
// small cut ≤24px; reversed (cream tile, oak face) ONLY on oak surfaces.
export function Porch({ size = 24, reversed = false }: { size?: number; reversed?: boolean }) {
  const tile = reversed ? '#fff7ee' : '#834a2b';
  const face = reversed ? '#834a2b' : '#fff7ee';
  return size <= 24 ? (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M5.5 22 C5.5 10.5 13.5 3.5 24 3.5 C34.5 3.5 42.5 10.5 42.5 22 L42.5 39 C42.5 42.5 40 44.5 37 44.5 L11 44.5 C8 44.5 5.5 42.5 5.5 39 Z" fill={tile} />
      <circle cx="17.8" cy="21" r="3.5" fill={face} />
      <circle cx="30.2" cy="21" r="3.5" fill={face} />
      <path d="M17 28.6 C20.2 33.6 27.8 33.6 31 28.6" fill="none" stroke={face} strokeWidth={4} strokeLinecap="round" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z" fill={tile} />
      <circle cx="18.4" cy="21.5" r="2.75" fill={face} />
      <circle cx="29.6" cy="21.5" r="2.75" fill={face} />
      <path d="M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4" fill="none" stroke={face} strokeWidth={2.9} strokeLinecap="round" />
    </svg>
  );
}

// The mark that wakes: the desktop's first-open Peek (apps/desktop/src/renderer/src/brand.tsx
// PorchMark animated + tokens.css `.launchpeek.full`), verbatim geometry and group structure.
// The CSS on `.porchmark.playpeek` plays arch fade → eyes peek → look left/right/centre → smile
// draw → bounce once, then rests as the plain mark; hover blinks. Reduced motion collapses it.
export function PorchLive({ size = 70 }: { size?: number }) {
  const eyes = [[18.4, 21.5, 2.75], [29.6, 21.5, 2.75]].map(([x, y, r]) => <circle key={x} cx={x} cy={y} r={r} fill="#fff7ee" />);
  const arch = 'M6.5 22 C6.5 11 14 4.5 24 4.5 C34 4.5 41.5 11 41.5 22 L41.5 38.5 C41.5 41.8 39.3 43.5 36.5 43.5 L11.5 43.5 C8.7 43.5 6.5 41.8 6.5 38.5 Z';
  return (
    <svg className="porchmark playpeek" width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path className="pk-arch" d={arch} fill="#834a2b" />
      <defs><clipPath id="pk-clip"><path d={arch} /></clipPath></defs>
      <g clipPath="url(#pk-clip)">
        <g className="pk-peekg"><g className="pk-lookg"><g className="pk-blinkg">{eyes}</g></g></g>
      </g>
      <path className="pk-smile" d="M17.6 28.4 C20.3 32.8 27.7 32.8 30.4 28.4" pathLength={1} fill="none" stroke="#fff7ee" strokeWidth={2.9} strokeLinecap="round" />
    </svg>
  );
}

// mark + lowercase wordmark — the one lockup every brand site renders
export function BrandLockup({ reversed = false, size = 16 }: { reversed?: boolean; size?: number }) {
  return (
    <>
      <Porch size={Math.round(size * 1.54)} reversed={reversed} />
      <span className="wm" style={reversed ? { color: '#fff7ee' } : undefined}>neuramesh</span>
    </>
  );
}

export function Weave({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 600 400" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <g key={i} stroke="currentColor" strokeWidth="2" fill="none" opacity={0.9 - i * 0.12}>
          <path d={`M-40 ${60 + i * 90} c160 0 200 ${i % 2 ? 140 : -140} 360 ${i % 2 ? 140 : -140} c160 0 200 ${i % 2 ? -140 : 140} 360 ${i % 2 ? -140 : 140}`} />
        </g>
      ))}
    </svg>
  );
}

export const IconApple = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.05 12.5c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.59-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.23 2.61 1.29-.05 1.78-.84 3.34-.84 1.56 0 2 .84 3.37.81 1.39-.03 2.27-1.28 3.12-2.54.98-1.46 1.39-2.86 1.41-2.93-.03-.01-2.71-1.04-2.74-4.13zM14.6 4.84c.71-.86 1.19-2.06 1.06-3.25-1.02.04-2.26.68-2.99 1.54-.65.76-1.23 1.98-1.07 3.14 1.13.09 2.29-.58 3-1.43z" /></svg>;

export const IconDownload = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3v12M7 11l5 5 5-5M5 21h14" /></svg>;

export const IconSignOut = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;

export const IconChevron = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>;

// ── connector glyphs (single-ink, currentColor) ──
export const GlyphX = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M17.9 3H21l-6.8 7.8L22.2 21h-6.3l-4.9-6.4L5.4 21H2.2l7.3-8.3L2 3h6.4l4.4 5.9L17.9 3zm-1.1 16.1h1.7L7.1 4.8H5.3l11.5 14.3z" /></svg>;

export const GlyphIG = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1.15" fill="currentColor" stroke="none" /></svg>;

export const GlyphLI = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.4 8.4h4.2V23H.4V8.4zm7.1 0h4v2h.06c.56-1.06 1.93-2.18 3.97-2.18 4.25 0 5.03 2.8 5.03 6.44V23h-4.2v-6.9c0-1.65-.03-3.77-2.3-3.77-2.3 0-2.65 1.8-2.65 3.65V23H7.5V8.4z" transform="scale(.86) translate(2 0)" /></svg>;

export const GlyphTT = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16.7 2h3c.2 1.7 1.1 3.4 2.9 4.3.5.3 1 .5 1.4.6v3.2c-1.6-.1-3.1-.6-4.3-1.5v6.8c0 4-2.8 6.8-6.6 6.8-3.6 0-6.4-2.7-6.4-6.3 0-3.7 3-6.5 6.8-6.3v3.3c-1.9-.3-3.5 1-3.5 3 0 1.8 1.4 3.1 3.1 3.1 1.9 0 3.4-1.4 3.4-3.7V2h.2z" transform="scale(.82) translate(1.5 1)" /></svg>;

export const GlyphMail = ({ s = 16 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M3.5 7.5 12 13.5 20.5 7.5" /></svg>;

// ── deck stop 6 · THE POLICY ENGINE ──
export const LockGlyph = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden><rect x="5" y="10.5" width="14" height="9.5" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;

// ── Provider logomarks (used by the /model-benchmarks page via MARK_FOR) ────────
// Official brand paths (simple-icons), tinted to read in both themes: Claude in its
// terracotta, OpenAI adaptive ink (its mark is monochrome), Gemini in its spark gradient.
export const ClaudeMark = () => <svg className="brandmark" viewBox="0 0 24 24" fill="#D97757" aria-hidden><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" /></svg>;

export const OpenAIMark = () => <svg className="brandmark" viewBox="0 0 24 24" fill="var(--ink)" aria-hidden><path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" /></svg>;

export const GeminiMark = () => <svg className="brandmark" viewBox="0 0 24 24" aria-hidden><defs><linearGradient id="nmGeminiGrad" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#4285F4" /><stop offset=".45" stopColor="#9b72cb" /><stop offset="1" stopColor="#d96570" /></linearGradient></defs><path fill="url(#nmGeminiGrad)" d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" /></svg>;

export const IconMail = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="2.5" y="4.5" width="19" height="15" rx="3" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>;
