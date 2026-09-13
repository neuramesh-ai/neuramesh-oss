// A task's artifacts on mobile — the deliverables list, each row a door to the viewer.
// Split out of app/task/[id]/index.tsx (track D): the icon and label mapping is a lookup, and
// the list is the only thing that reads it.
import { Feather } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from './theme';
import { F, R } from './type';

export function artIcon(kind: string): 'file-text' | 'layout' | 'code' | 'image' | 'check-circle' | 'paperclip' {
  if (kind === 'design') return 'layout';
  if (kind === 'diff' || kind === 'code') return 'code';
  if (kind === 'image') return 'image';
  if (kind === 'review' || kind === 'ship') return 'check-circle';
  if (kind === 'attachment') return 'paperclip';
  return 'file-text';
}

export function artLabel(kind: string, name: string): string {
  return (kind === 'plan' && /^ship-plan/.test(name) ? 'ship plan' : kind).toUpperCase();
}

export function TaskArtifacts({ rows, label }: {
  rows: Array<{ id: string; kind: string; name: string }>;
  label: object;
}) {
  const t = useTheme();
  if (!rows.length) return null;
  return (
    <>
        <Text style={label}>Artifacts</Text>
        <View style={{ marginHorizontal: 16, borderWidth: 1, borderColor: t.border, borderRadius: R.lg, overflow: 'hidden' }}>
          {rows.map((art, i) => (
            <Pressable
              key={art.id}
              onPress={() => router.push(`/artifact/${art.id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: t.panel, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: t.border }}
            >
              <Feather name={artIcon(art.kind)} size={15} color={t.accent} />
              <Text style={{ color: t.text, fontSize: 13, flex: 1 }} numberOfLines={1}>
                {art.name}
              </Text>
              <Text style={{ ...F.mono(500), color: t.dim, fontSize: 9.5, letterSpacing: F.tight(9.5) }}>{artLabel(art.kind, art.name)}</Text>
              <Feather name="chevron-right" size={15} color={t.dim} />
            </Pressable>
          ))}
        </View>
    </>
  );
}
