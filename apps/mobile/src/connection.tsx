import { useStatus } from '@powersync/react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View, type ViewStyle } from 'react-native';
import { getNeedsReauth, lastHandoffTrouble, loadSession, onReauthChange, refreshToken, signIn } from './auth';
import { reconnectTrouble } from './reconnect-trouble';
import { clearDroppedUpload, getDroppedUpload, onDroppedUpload, type DroppedUpload } from './upload-trouble';
import { connect } from './system';
import { useTheme } from './theme';
import { F } from './type';

// Whether the sync session needs re-authentication (subscribes to the auth signal).
export function useReauth(): boolean {
  const [v, setV] = useState(getNeedsReauth());
  useEffect(() => onReauthChange(setV), []);
  return v;
}

// A thin status strip above the tabs. Session lapsed → a tap-to-reconnect banner
// (local data stays readable); merely offline → a quiet "showing local data" note;
// connected → nothing. This is the plan's "long-offline phone" hardening.
//
// AND IT TRIES BY ITSELF (George, 2026-09-06: "app should also automatically try to reconnect when
// it's open if it's disconnected"). The SDK retries its socket, but a lapsed token is re-minted by
// this component and it only ever ran on a tap, so a phone that woke to a dead token sat behind the
// banner until somebody pressed it. It now retries on its own while the app is in the foreground,
// backing off 4s · 8s · 16s · 30s so a genuinely offline phone is not a radio in a loop, and it
// tries at once whenever the app comes back to the front, which is when the network usually did.
// A REAUTH IS NEVER AUTOMATIC: that path opens a browser, and a browser opens when a person asks.
/** a send the server refused, kept until the person has seen it */
function useDroppedUpload(): DroppedUpload | null {
  const [d, setD] = useState(getDroppedUpload());
  useEffect(() => onDroppedUpload(setD), []);
  return d;
}

export function OfflineBanner() {
  const t = useTheme();
  const status = useStatus();
  const reauth = useReauth();
  const dropped = useDroppedUpload();
  const [busy, setBusy] = useState(false);
  // WHY THE LAST ATTEMPT FAILED. The catch below said nothing, so a tap that could not work looked
  // exactly like a tap that was ignored (George, 2026-09-06: "i tried reconnecting manually, but it
  // also didn't"). The banner carries the reason now, the same ruling as the refused send.
  const [trouble, setTrouble] = useState<string | null>(null);
  const tries = useRef(0);

  // Re-establish the sync stream. The common case is a lapsed ~10-min sync token or a brief
  // network drop: re-mint + reconnect silently. Only when the session is genuinely gone (reauth)
  // do we escalate to the full sign-in handoff — a transient-offline tap must never hijack the
  // user into a 90s re-auth; PowerSync keeps auto-retrying in the background meanwhile.
  const reconnect = useCallback(async function reconnect() {
    setBusy(true);
    setTrouble(null);
    try {
      const session = await loadSession();
      if (!session?.sessionId) {
        await connect(await signIn());
        return;
      }
      try {
        await refreshToken(session);
        await connect(session);
      } catch (e) {
        if (reauth) await connect(await signIn());
        else throw e; // transient offline — leave it to PowerSync's auto-retry
      }
    } catch (e) {
      setTrouble(reconnectTrouble(e, lastHandoffTrouble()));
    } finally {
      setBusy(false);
    }
  }, [reauth]);

  // the automatic half: a backing-off retry while disconnected, and one on every return to the
  // front. Connected resets the ladder, so the next outage starts patient again.
  const connected = status.connected;
  useEffect(() => {
    if (connected) { tries.current = 0; setTrouble(null); return; }
    if (reauth) return;                                   // needs a person, not a timer
    const wait = [4000, 8000, 16000, 30000][Math.min(tries.current, 3)] ?? 30000;
    const id = setTimeout(() => { tries.current += 1; void reconnect(); }, wait);
    return () => clearTimeout(id);
  }, [connected, reauth, reconnect, busy]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || connected || reauth) return;
      tries.current = 0;
      void reconnect();
    });
    return () => sub.remove();
  }, [connected, reauth, reconnect]);

  // The spinner reflects a MANUAL reconnect in flight (busy), not PowerSync's background retry:
  // while offline the SDK sits in a perpetual `connecting` loop, so keying the UI on that would
  // hide the Reconnect button forever behind a spinner. Offline → always show a tappable button;
  // a successful background reconnect just clears the banner (status.connected flips true).
  const bar: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: t.border };

  // A REFUSED SEND OUTRANKS EVERY OTHER STATE. It is the only one where something the person made
  // is already gone, and it does not clear itself: the row it names is not coming back.
  if (dropped) {
    return (
      <View style={[bar, { backgroundColor: `${t.warn}1f`, alignItems: 'flex-start', paddingVertical: 9 }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.warn, marginTop: 5 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.warn, fontSize: 12, ...F.body(600) }}>That message did not send.</Text>
          <Text style={{ color: t.muted, fontSize: 11.5, lineHeight: 16, marginTop: 1 }} numberOfLines={3}>{dropped.reason}</Text>
          {/* the words themselves, so they can be read back rather than remembered */}
          {dropped.body ? <Text style={{ color: t.body, fontSize: 11.5, lineHeight: 16, marginTop: 4 }} numberOfLines={4}>{dropped.body}</Text> : null}
        </View>
        <Pressable onPress={clearDroppedUpload} hitSlop={8}><Text style={{ color: t.warn, fontSize: 12, ...F.body(600) }}>Dismiss</Text></Pressable>
      </View>
    );
  }
  // Session genuinely lapsed → an attention-toned, tap-to-reconnect banner (local data stays readable).
  if (reauth) {
    return (
      <Pressable onPress={reconnect} disabled={busy} style={[bar, { alignItems: 'flex-start', backgroundColor: `${t.blocked}22` }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.blocked, marginTop: 5 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.blocked, fontSize: 12 }}>{busy ? 'Please wait…' : 'The session expired. Your data is safe.'}</Text>
          {!busy && trouble ? <Text style={{ color: t.muted, fontSize: 11.5, lineHeight: 16, marginTop: 1 }} numberOfLines={3}>{trouble}</Text> : null}
        </View>
        {busy ? <ActivityIndicator color={t.blocked} size="small" /> : <Text style={{ color: t.blocked, fontSize: 12, ...F.body(600), marginTop: 1 }}>Reconnect</Text>}
      </Pressable>
    );
  }
  // Merely offline (network) → a quiet strip; local reads still work. Tap to retry now.
  if (!status.connected) {
    return (
      <Pressable onPress={reconnect} disabled={busy} style={[bar, { alignItems: 'flex-start', backgroundColor: t.panel2 }]}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: busy ? t.accent : t.dim, marginTop: 5 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.muted, fontSize: 12 }}>{busy ? 'Please wait…' : 'Offline. This shows local data.'}</Text>
          {!busy && trouble ? <Text style={{ color: t.dim, fontSize: 11.5, lineHeight: 16, marginTop: 1 }} numberOfLines={3}>{trouble}</Text> : null}
        </View>
        {busy ? <ActivityIndicator color={t.muted} size="small" /> : <Text style={{ color: t.accent, fontSize: 12, ...F.body(600), marginTop: 1 }}>Reconnect</Text>}
      </Pressable>
    );
  }
  return null;
}
