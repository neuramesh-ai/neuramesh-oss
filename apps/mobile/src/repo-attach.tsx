// ATTACHING A REPO IS AN OFFER, NOT A DEAD END (the mobile fix round, 2026-09-06; George: "when
// Code says no repo for a project, it should provide a link or button a user can click to set up a
// repo").
//
// The composer's note used to say "no repo attached to this project" as plain text, which names the
// problem and offers nothing. The sentence is a link now, and this is what it opens: the repos the
// workspace already knows first, one tap each, then a URL.
//
// A FOLDER ON A COMPUTER STAYS A COMPUTER'S. `repo.link` also takes a `localPath`, and a phone
// cannot honour it — there is no folder here to point at, and the path would name a machine this
// app is not running on. The card says so rather than offering a picker that could only lie.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, Text, TextInput, View } from 'react-native';
import { api } from './auth';
import { Icon } from './icon';
import { Btn, Card, inputStyle } from './kit';
import { errMsg } from './onboard';
import { looksLikeRepoUrl } from './repo-url';
import { useTheme } from './theme';
import { F } from './type';

export interface WorkspaceRepo { id: string; name: string; org_name: string | null; default_branch: string | null }

export function RepoAttach({ workspace, projectId, projectName, repos, onClose, onAttached }: {
  workspace: string;
  projectId: string;
  projectName: string;
  /** repos already in this workspace, so the common case is one tap */
  repos: WorkspaceRepo[];
  onClose: () => void;
  onAttached: () => void;
}) {
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const canAdd = useMemo(() => looksLikeRepoUrl(url), [url]);
  // the card RISES out of the composer it was opened from: docs/33 §7's `nm-rise` (fade + 7px,
  // .22s, non-blocking), the house entrance, here in React Native for the first time. Reduced
  // motion stills it, as §7 requires, and the card simply appears.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((still) => {
      if (!alive) return;
      if (still) { rise.setValue(1); return; }
      Animated.timing(rise, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }).catch(() => rise.setValue(1));
    return () => { alive = false; };
  }, [rise]);

  async function link(input: { url?: string; name?: string; defaultBranch?: string }, key: string) {
    if (busy) return;
    setBusy(key);
    setErr('');
    try {
      await api.command({ type: 'repo.link', workspace, project: projectId, defaultBranch: input.defaultBranch ?? 'main', ...(input.url ? { url: input.url } : {}), ...(input.name ? { name: input.name } : {}) });
      onAttached();
      onClose();
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <Animated.View style={{ opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) }] }}>
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, flex: 1 }}>Attach a repo to {projectName}</Text>
        <Pressable onPress={onClose} hitSlop={10}><Icon name="close" size={14} color={t.dim} /></Pressable>
      </View>
      {/* one tap sends the row's OWN identity, not its clone url: the server re-parses whatever we
          send, and org/name is the pair it already stored, while a clone url may be a mirror it
          cannot read. Local repos never reach this list — a folder belongs to its own machine. */}
      {repos.map((r) => (
        <Pressable key={r.id} disabled={!!busy} onPress={() => void link({ url: `${r.org_name ?? ''}/${r.name}`, defaultBranch: r.default_branch ?? 'main' }, r.id)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: t.border }}>
          <Icon name="branch" size={14} color={t.muted} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ ...F.body(500), fontSize: 13, color: t.text }} numberOfLines={1}>{r.org_name ? `${r.org_name}/${r.name}` : r.name}</Text>
            <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 1 }}>in this workspace · {r.default_branch ?? 'main'}</Text>
          </View>
          {busy === r.id ? <ActivityIndicator color={t.muted} /> : <Text style={{ ...F.body(600), fontSize: 12, color: t.link }}>Attach</Text>}
        </Pressable>
      ))}
      <TextInput value={url} onChangeText={setUrl} placeholder="https://github.com/org/repo" placeholderTextColor={t.dim} autoCapitalize="none" autoCorrect={false} keyboardType="url"
        style={{ ...inputStyle(t, false, true), fontSize: 12, marginTop: 10 }} />
      {err ? <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 17, color: t.warn, marginTop: 8 }}>{err}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <Btn sm kind="primary" label={busy === 'url' ? 'Please wait…' : 'Add by URL'} disabled={!canAdd || !!busy} onPress={() => void link({ url: url.trim() }, 'url')} />
        <Btn sm label="Not now" onPress={onClose} />
      </View>
      <Text style={{ ...F.mono(500), fontSize: 10, lineHeight: 15, color: t.dim, marginTop: 9 }}>A folder on a computer is attached from that computer, in the desktop app.</Text>
    </Card>
    </Animated.View>
  );
}
