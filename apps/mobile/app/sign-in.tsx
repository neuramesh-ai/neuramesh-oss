// WELCOME (the mobile-cloud round S6, D15): start free or sign in. Both ride the existing handoff
// page in Safari — sign-up mode is a param the page reads — and return a verified session; the
// app never sees a password. Cloud-first copy: a workspace comes with its machine, nothing to
// install. The "download the desktop app first" sheet retired with the companion era.
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { HANDOFF_SECONDS, HANDOFF_TIMEOUT, signIn } from '../src/auth';
import { PorchMark } from '../src/brand';
import { IS_DEV } from '../src/config';
import { Btn, isDarkTheme } from '../src/kit';
import { connect } from '../src/system';
import { useTheme } from '../src/theme';
import { F, R } from '../src/type';

// Never surface a raw thrown value: an Error whose message is empty or the infamous
// "[object Object]" (a lib that built `new Error(someObject)`) becomes a real sentence.
function cleanErr(e: unknown): string {
  if (e instanceof Error && e.message && e.message !== '[object Object]') return e.message.slice(0, 140);
  return 'Something went wrong. Check your connection, then try again.';
}

export default function SignIn() {
  const t = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState<'signup' | 'signin' | null>(null);
  const [waiting, setWaiting] = useState(false); // prod browser-handoff in progress
  const [waitLeft, setWaitLeft] = useState(HANDOFF_SECONDS);
  const [error, setError] = useState<string | null>(null);

  // Mirror the handoff window as a visible countdown; at 0 the poll has given up and the
  // buttons re-enable for a fresh attempt (the desktop's sign-in does the same).
  useEffect(() => {
    if (!waiting) return;
    setWaitLeft(HANDOFF_SECONDS);
    const id = setInterval(() => setWaitLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [waiting]);

  async function go(mode: 'signup' | 'signin') {
    if (busy) return;
    setError(null);
    setBusy(mode);
    if (!IS_DEV) setWaiting(true);
    try {
      const session = await signIn(mode === 'signup' ? { mode: 'signup' } : {});
      // The session landed — go straight in. Sync connects in the background; a network hiccup
      // must never block a good sign-in (local reads work; the reauth banner recovers). The
      // arrival gate decides what comes next: the tabs, an invitation, or the wizard.
      void connect(session).catch(() => {});
      router.replace('/onboarding');
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(msg === HANDOFF_TIMEOUT ? 'The sign-in did not finish in time. Tap to try again.' : cleanErr(e));
    } finally {
      setBusy(null);
      setWaiting(false);
    }
  }

  const dark = isDarkTheme(t.bg);
  const slot = { marginTop: 16, width: '100%' as const, maxWidth: 360, backgroundColor: t.card, borderColor: t.cardBorder, borderWidth: 1, borderRadius: R.lg, paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
        {/* the mark on its tile: the one elevated object on this screen */}
        <View style={{ width: 84, height: 84, borderRadius: R.lg, backgroundColor: t.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.cardBorder, shadowColor: '#000', shadowOpacity: dark ? 0.3 : 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }}>
          <PorchMark size={52} />
        </View>
        <Text style={{ ...F.body(600), color: t.text, fontSize: 26, marginTop: 22, letterSpacing: -0.4 }}>neuramesh</Text>
        <Text style={{ ...F.body(500), color: t.body, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20, maxWidth: 290 }}>Your people. Your agents. Your projects.</Text>
        <Text style={{ ...F.body(400), color: t.dim, fontSize: 12.5, marginTop: 10, textAlign: 'center', lineHeight: 18, maxWidth: 300 }}>
          A cloud machine comes with your workspace. You install nothing.
        </Text>

        <Btn kind="primary" label={busy === 'signup' ? 'Please wait…' : IS_DEV ? 'Start free (dev user)' : 'Start free'} onPress={() => void go('signup')} disabled={!!busy}
          icon={busy === 'signup' ? <ActivityIndicator color={t.brandInk} /> : undefined} style={{ marginTop: 28, width: '100%', maxWidth: 360 }} />
        <Btn label={busy === 'signin' ? 'Please wait…' : IS_DEV ? 'Continue as dev user' : 'Sign in'} onPress={() => void go('signin')} disabled={!!busy}
          icon={busy === 'signin' ? <ActivityIndicator color={t.text} /> : undefined} style={{ marginTop: 10, width: '100%', maxWidth: 360 }} />

        {/* One slot below the buttons: live handoff status, then error, then the resting hint. */}
        {waiting ? (
          <View style={slot}>
            <Text style={{ color: t.link, fontSize: 15, ...F.body(600), marginTop: 1 }}>↗</Text>
            <Text style={{ ...F.body(400), color: t.body, fontSize: 12.5, lineHeight: 18, flex: 1 }}>
              Finish the sign-in in Safari. This app opens again for you.{'\n'}
              <Text style={{ color: t.dim }}>{waitLeft > 0 ? `You can start again in ${waitLeft}s.` : 'Almost done.'}</Text>
            </Text>
          </View>
        ) : error ? (
          <View style={slot}>
            <Text style={{ color: t.warn, fontSize: 14, marginTop: 1 }}>↻</Text>
            <Text style={{ ...F.body(400), color: t.body, fontSize: 12.5, lineHeight: 18, flex: 1 }}>{error}</Text>
          </View>
        ) : (
          <Text style={{ ...F.body(400), color: t.dim, fontSize: 11.5, marginTop: 14, textAlign: 'center', lineHeight: 17, maxWidth: 300 }}>
            {IS_DEV ? 'Local dev stack. This signs in as the dev user.' : 'Both buttons open neuramesh.app in Safari.'}
          </Text>
        )}
      </View>
      <Text style={{ ...F.mono(500), color: t.dim, fontSize: 10.5, textAlign: 'center', letterSpacing: F.track, paddingBottom: 30 }}>your compute · cloud truth</Text>
    </View>
  );
}
