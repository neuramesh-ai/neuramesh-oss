// The handoff page's two faces (the mobile-cloud round, D15): the phone's "Start free" opens
// neuramesh.app/desktop-signin in SIGN-UP mode, "Sign in" in sign-in mode. Same page, same nonce,
// same completion; the param only decides which Clerk face opens first. Pure, so it is testable
// without mounting Clerk.
export type SigninMode = 'signin' | 'signup';

export function signinMode(value: string | null | undefined): SigninMode {
  return value === 'signup' ? 'signup' : 'signin';
}

/** the page's own url with the nonce kept and the face set, where Clerk's "sign in / sign up" links go.
 *  `/pro` (the Get Pro handoff) serves the same two faces from the same helper, so it needs no second sign-in. */
export function handoffUrl(nonce: string | null, mode: SigninMode, path: '/desktop-signin' | '/pro' = '/desktop-signin'): string {
  const params = new URLSearchParams();
  if (nonce) params.set('nonce', nonce);
  if (mode === 'signup') params.set('mode', 'signup');
  const q = params.toString();
  return `${path}${q ? `?${q}` : ''}`;
}
