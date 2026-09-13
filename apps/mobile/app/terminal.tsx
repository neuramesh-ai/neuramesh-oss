// THE TERMINAL (S8, D11): a shell on YOUR cloud machine, in a WebView running xterm.js over the
// relay — the vendor-login door for a member who only has a phone (`claude setup-token`, `gh auth
// login` complete in the vendor's own flow, on a machine you own). The WebView owns its socket
// (src/terminal-html.ts is the page; terminal/page.ts its source); this screen hands it the relay
// url, the bearer, the machine and the theme by message, and draws the key row the software
// keyboard lacks (Esc · Tab · ^C · arrows · a paste line). IT NEVER PRETENDS: no relay on the
// build or no machine is a sentence, never an empty pane.
//
// IT WAKES THE MACHINE FIRST (George on the TestFlight build, 2026-09-06: "when I try to click on
// connect for my Claude subscription from mobile, it errors with the connection closed error").
// A cloud machine dials the relay only while it is AWAKE, so a shell opened on a sleeping one
// reached a relay that had never heard of it and the channel closed at once — twice, because the
// page retries. Code already waited on the shared `ensureMachine`; this screen went straight to
// `open`. It now runs the same boot and says which phase it is in, so the wait is visible and a
// refusal has a reason.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Btn, Card, Tok } from '../src/kit';
import { RELAY_URL } from '../src/config';
import { Icon } from '../src/icon';
import { ensureCodeMachine, relayBearer, relayConfigured } from '../src/relay';
import { useActiveWorkspace } from '../src/ui';
import { asciiForShell } from '../src/shell-text';
import { TERMINAL_HTML } from '../src/terminal-html';
import { useTheme } from '../src/theme';
import { F, R } from '../src/type';

// the key row: what a phone keyboard cannot type, as bytes a pty understands. `↵` is here and not
// on the paste line on purpose — a pasted script runs when YOU say so, not because it arrived.
const KEYS: Array<{ label: string; data: string }> = [
  { label: '↵', data: '\r' }, { label: 'esc', data: '\x1b' }, { label: 'tab', data: '\t' }, { label: '^C', data: '\x03' }, { label: '^D', data: '\x04' },
  { label: '↑', data: '\x1b[A' }, { label: '↓', data: '\x1b[B' }, { label: '←', data: '\x1b[D' }, { label: '→', data: '\x1b[C' },
];

export default function TerminalScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ machine?: string; name?: string }>();
  const web = useRef<ComponentRef<typeof WebView>>(null);
  const [state, setState] = useState<'booting' | 'open' | 'exited'>('booting');
  const [title, setTitle] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [paste, setPaste] = useState('');
  const [boot, setBoot] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ws = useActiveWorkspace();
  const machineId = params.machine ?? null;
  // expo-router reuses this screen when the same path arrives with new params, so the state is
  // reset here rather than left claiming the previous machine's session
  const lastMachine = useRef(machineId);
  if (lastMachine.current !== machineId) { lastMachine.current = machineId; if (state !== 'booting') setState('booting'); }
  const name = params.name ?? 'your cloud machine';
  const lane = relayConfigured();

  const send = useCallback((m: Record<string, unknown>) => {
    web.current?.postMessage(JSON.stringify(m));
  }, []);
  // the page says `ready` once xterm is mounted; only then does it get the credentials — a message
  // posted before the listener exists is a message nobody hears
  const onMessage = useCallback(async (raw: string) => {
    let m: { type?: string; text?: string };
    try { m = JSON.parse(raw) as { type?: string; text?: string }; } catch { return; }
    if (m.type === 'log') { console.log(`[nm] terminal: ${m.text ?? ''}`); return; }
    if (m.type === 'ready') {
      // the machine has to be awake before the relay has anything to route to
      if (ws && machineId) {
        setErr(null);
        setBoot('waking');
        const out = await ensureCodeMachine(ws, machineId, (phase) => setBoot(phase));
        setBoot(null);
        if (!out.ok) { setErr(out.detail ?? `The machine could not be woken (${out.reason}).`); setState('exited'); return; }
      }
      const bearer = await relayBearer();
      send({ type: 'open', relayUrl: RELAY_URL, bearer, machineId, theme: { bg: t.bg, fg: t.text, dim: t.dim, cursor: t.link, selection: `${t.link}55` } });
      setState('open');
    } else if (m.type === 'exit') setState('exited');
    else if (m.type === 'title' && m.text) setTitle(m.text);
  }, [send, machineId, t, ws]);

  const sendPaste = () => {
    if (!paste) return;
    // iOS rewrote `--version` to `—version` while you typed it; a shell needs the ASCII back
    send({ type: 'input', data: asciiForShell(paste) });
    setPaste('');
    setPasting(false);
  };
  const key = (k: Pick<TextInput, never> & { padding: number }) => ({ paddingHorizontal: k.padding, paddingVertical: 7, borderRadius: R.pill, borderWidth: 1, borderColor: t.border2, backgroundColor: t.panel2 });
  // AN HTTP ORIGIN, DELIBERATELY: a page served as https may not open a ws:// socket (mixed
  // content, and WKWebView fails it silently), which is exactly the local relay in development.
  // `.local` + loopback are what NSAllowsLocalNetworking permits; production dials wss://, legal
  // from either origin.
  const source = useMemo(() => ({ html: TERMINAL_HTML, baseUrl: 'http://app.neuramesh.local/' }), []);

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="arrowL" size={13} color={t.dim} />
          <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }}>compute</Text>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <Text style={{ ...F.body(600), fontSize: 15, color: t.text, flex: 1 }} numberOfLines={1}>{title ?? name}</Text>
          <Tok icon={<Icon name="cloudMachine" size={11} color={t.muted} />}>{name}</Tok>
          {/* the state tok speaks for a lane that exists; a refusal says its own sentence below */}
          {lane && machineId ? <Tok warm={state === 'open'}>{boot ? 'waking' : state === 'open' ? 'attached' : state === 'exited' ? 'closed' : 'dialing'}</Tok> : null}
        </View>
        {/* the wait is visible, and a refusal says why — a shell that just closed said nothing */}
        {boot ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 6 }}>{`Waking ${name} · ${boot === 'waking' ? 'checks the fleet' : boot}`}</Text> : null}
        {err ? <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.warn, marginTop: 6 }}>{err}</Text> : null}
      </View>
      {!lane || !machineId ? (
        <Card>
          <Text style={{ ...F.display(), fontSize: 17, letterSpacing: F.tight(17), color: t.text }}>{!lane ? 'No relay on this build.' : 'No cloud machine yet.'}</Text>
          <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 4 }}>
            {!lane ? 'A terminal reaches your machine through nm-relay. This build has no relay. Open a terminal on a computer instead.' : 'Send a message to start one, then open the terminal again.'}
          </Text>
        </Card>
      ) : (
        <View style={{ flex: 1, marginHorizontal: 12, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: t.cardBorder, backgroundColor: t.bg }}>
          <WebView ref={web} source={source} originWhitelist={['*']} javaScriptEnabled onMessage={(e) => void onMessage(e.nativeEvent.data)}
            style={{ backgroundColor: t.bg }} keyboardDisplayRequiresUserAction={false} hideKeyboardAccessoryView allowsBackForwardNavigationGestures={false}
            onShouldStartLoadWithRequest={(req) => req.url.startsWith('http://app.neuramesh.local/') || req.url === 'about:blank'} />
        </View>
      )}
      {lane && machineId ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: Math.max(insets.bottom, 10) }}>
          {pasting ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <TextInput value={paste} onChangeText={setPaste} placeholder="Paste, then send to the shell" placeholderTextColor={t.dim} autoFocus autoCapitalize="none" autoCorrect={false} onSubmitEditing={sendPaste}
                style={{ ...F.mono(500), fontSize: 12.5, color: t.text, flex: 1, backgroundColor: t.panel2, borderWidth: 1, borderColor: t.border2, borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 8 }} />
              <Btn sm kind="primary" label="Send" onPress={sendPaste} disabled={!paste} />
            </View>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6 }}>
            {KEYS.map((k) => (
              <Pressable key={k.label} onPress={() => send({ type: 'input', data: k.data })} style={key({ padding: 12 })}>
                <Text style={{ ...F.mono(500), fontSize: 11.5, color: t.text }}>{k.label}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPasting((p) => !p)} style={key({ padding: 12 })}>
              <Text style={{ ...F.mono(500), fontSize: 11.5, color: pasting ? t.link : t.text }}>paste</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}
