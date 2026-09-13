// The update card's two pure rules, shared by the shell and the sign-in screen so both agree on
// what "an update is showing" means: the key a dismissal is remembered under, and whether the
// card is visible. DOM-free on purpose — src/main's test runner pins them.
//
// Why the sign-in screen needs them at all (2026-09-05): a signed-out user may be signed out
// BECAUSE the build is stale — prod stopped accepting a credential the installed build sent, the
// app read the 401 as a dead session and signed itself out, and the only card that could have
// saved them lived inside the signed-in shell. The update has to be reachable before sign-in.
import type { UpdateState } from '../bridge/rows-infra';

/** one dismissal per phase+version: a newer version, or the same one reaching 'ready', shows again */
export const updateKey = (s: UpdateState): string => s.phase + ':' + ('version' in s ? s.version : '');

/** idle never shows; a dismissed key stays hidden until the state moves on */
export const updateVisible = (s: UpdateState, hidden: string | null): boolean =>
  s.phase !== 'idle' && hidden !== updateKey(s);
