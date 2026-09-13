import type { Theme } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { marked } from 'marked';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Icon } from '../../src/icon';
import { useTheme } from '../../src/theme';
import { F } from '../../src/type';

interface Artifact {
  id: string;
  kind: string;
  name: string;
  inline_content: string;
  mime: string;
  width: number;
  height: number;
  size_bytes: number | null;
  created_at: string;
}

// Which renderer an artifact needs — mirrors the desktop's previewType(): design mockups and
// bare HTML → a sandboxed WebView; markdown docs (implementation plans) → rendered + themed
// HTML in the same WebView; images → <Image>; diffs and anything else → monospace text.
type Preview = 'html' | 'markdown' | 'image' | 'pdf' | 'diff' | 'raw' | 'opaque' | 'absent';

/** a data: URI whose payload is not text. Rendering one as monospace prints a screenful of base64,
 *  which is worse than saying nothing: it looks like corruption and it tells the reader nothing. */
const BINARY = /^data:(?!text\/|application\/(json|xml|javascript))[^;]+;base64,/i;
function previewOf(a: Artifact): Preview {
  const c = a.inline_content ?? '';
  // THE BYTES MAY SIMPLY NOT BE HERE. A desktop attachment stores a THUMBNAIL inline and keeps the
  // file on the machine that made it, so a phone can hold the row and none of the content. That is
  // a thing to say, not an empty screen (2026-09-07).
  if (!c.trim()) return 'absent';
  if (a.mime === 'application/pdf' || /^data:application\/pdf/i.test(c) || /\.pdf$/i.test(a.name)) return 'pdf';
  if (a.kind === 'design' || /^\s*<(!doctype|html|body|div|svg)/i.test(c)) return 'html';
  if (a.kind === 'screenshot' || /^data:image\//i.test(c) || (a.mime ?? '').startsWith('image/')) return 'image';
  if (a.kind === 'diff' || /^(diff --git |--- |\+\+\+ |@@ )/m.test(c)) return 'diff';
  if (/\.md$/i.test(a.name) || a.kind === 'doc') return 'markdown';
  // anything else that is plainly binary gets an honest card rather than its own base64
  if (BINARY.test(c)) return 'opaque';
  return 'raw';
}

/** bytes as a person reads them */
function fmtSize(n: number | null | undefined): string {
  if (!n) return '';
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`;
}

// Wrap marked's HTML in a self-contained doc styled from the current theme's tokens, so a plan
// reads like the desktop's react-markdown — in the app's colors, in either theme. All nav is
// blocked at the WebView; this is presentation only (the bytes are already synced locally).
function mdDoc(html: string, t: Theme): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 16px 18px 44px; background: ${t.bg}; color: ${t.body};
  font: 15px/1.62 -apple-system, system-ui, sans-serif; -webkit-text-size-adjust: 100%; overflow-wrap: break-word; }
h1,h2,h3,h4 { color: ${t.text}; line-height: 1.3; margin: 1.4em 0 .5em; font-weight: 700; }
h1 { font-size: 1.5em; } h2 { font-size: 1.28em; } h3 { font-size: 1.1em; }
p { margin: .6em 0; } a { color: ${t.accent}; text-decoration: none; }
strong { color: ${t.text}; }
code { background: ${t.panel2}; padding: 1px 5px; border-radius: 5px; font-size: .9em; font-family: ui-monospace, Menlo, monospace; }
pre { background: ${t.panel}; border: 1px solid ${t.border}; border-radius: 10px; padding: 12px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: .8em 0; padding: 8px 14px; border-left: 3px solid ${t.accent}; background: ${t.accentSoft}; border-radius: 0 8px 8px 0; color: ${t.muted}; }
ul,ol { padding-left: 1.4em; } li { margin: .25em 0; }
table { border-collapse: collapse; margin: .8em 0; display: block; overflow-x: auto; }
th,td { border: 1px solid ${t.border2}; padding: 6px 10px; text-align: left; font-size: .92em; }
th { background: ${t.panel2}; color: ${t.text}; }
hr { border: none; border-top: 1px solid ${t.border}; margin: 1.4em 0; }
img { max-width: 100%; }
</style></head><body>${html}</body></html>`;
}

// A read-only viewer for any synced artifact (implementation plans, design mockups, diffs,
// screenshots). Reached from a task's Artifacts section or a filename link in a thread.
export default function ArtifactViewer() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data } = useQuery<Artifact>('select id, kind, name, inline_content, mime, width, height, size_bytes, created_at from artifacts where id = ? limit 1', [id]);
  const [h, setH] = useState(0);
  const a = data?.[0];
  const preview = a ? previewOf(a) : 'raw';

  const html = useMemo(() => {
    if (!a) return '';
    if (preview === 'markdown') return mdDoc(marked.parse(a.inline_content ?? '', { async: false, gfm: true }) as string, t);
    if (preview === 'html') return a.inline_content ?? '';
    return '';
  }, [a, preview, t]);

  const header = (
    <Stack.Screen options={{ headerShown: true, title: a?.name ?? 'Artifact', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerTitleStyle: { fontSize: 14 } }} />
  );

  if (!a) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        {header}
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  if (preview === 'image') {
    const ratio = a.width && a.height ? a.width / a.height : undefined;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 12 }} maximumZoomScale={4} minimumZoomScale={1}>
        {header}
        <Image source={{ uri: a.inline_content }} style={{ width: '100%', aspectRatio: ratio, minHeight: ratio ? undefined : 240 }} resizeMode="contain" />
      </ScrollView>
    );
  }

  // A PDF IS A DOCUMENT THE PLATFORM ALREADY KNOWS. iOS renders one from a data: URI, so this costs
  // a WebView and no dependency. Without it a PDF fell to `raw` and printed its own base64.
  if (preview === 'pdf') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
        {header}
        {h > 0 ? (
          <WebView
            originWhitelist={['*']}
            source={{ uri: a.inline_content }}
            onShouldStartLoadWithRequest={(req) => !/^https?:/i.test(req.url)}
            style={{ width: '100%', height: h, backgroundColor: t.bg }}
          />
        ) : null}
      </View>
    );
  }

  // The two honest ends. `opaque` is a file we hold and cannot draw; `absent` is a file we do not
  // hold at all. Neither is an error, and neither is a blank screen.
  if (preview === 'opaque' || preview === 'absent') {
    const absent = preview === 'absent';
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        {header}
        <Icon name="file" size={30} color={t.dim} />
        <Text style={{ ...F.body(600), fontSize: 14.5, color: t.text, marginTop: 12, textAlign: 'center' }} numberOfLines={2}>{a.name}</Text>
        <Text style={{ ...F.mono(500), fontSize: 11, color: t.dim, marginTop: 4 }}>{[fmtSize(a.size_bytes), a.mime].filter(Boolean).join(' · ')}</Text>
        <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 19, color: t.muted, marginTop: 14, textAlign: 'center', maxWidth: 300 }}>
          {absent
            ? 'This file lives on the machine that made it. Open it there, or ask the room for it.'
            : 'The phone has no preview for this kind of file.'}
        </Text>
      </View>
    );
  }

  if (preview === 'diff' || preview === 'raw') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 14 }}>
        {header}
        <Text style={{ ...F.mono(400), color: t.body, fontSize: 12, lineHeight: 18 }}>{a.inline_content}</Text>
      </ScrollView>
    );
  }

  // markdown or html → WebView. A flex WebView can land a 0-height frame on iOS (New Arch), so
  // give it a concrete height from the measured container (same guard as the design viewer).
  const bg = preview === 'html' && a.kind === 'design' ? '#ffffff' : t.bg;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      {header}
      {h > 0 ? (
        <WebView
          originWhitelist={['*']}
          source={{ html }}
          onShouldStartLoadWithRequest={(req) => !/^https?:/i.test(req.url)}
          style={{ width: '100%', height: h, backgroundColor: bg }}
        />
      ) : null}
    </View>
  );
}
