// THE CREW ON THE PHONE (S6): the Team step's cards (a tile · the name, editable in place · the
// role · the pack's brain as one mono fact) and the Launch reveal (the six faces in a grid, a
// green dot each once they exist, the stats line, the assembling copy). The faces are letter
// tiles, not emoji: the phone's identity-well idiom, and the one face that never renders as a box.
import type { WizardCrewMember } from '@neuramesh/shared';
import { Text, TextInput, View } from 'react-native';
import { Tile } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';

export function CrewCard({ member, brain, onName }: { member: WizardCrewMember; brain: string; onName: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 11, paddingVertical: 8, backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg }}>
      <Tile label={member.name || member.role} size={34} round={false} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <TextInput value={member.name} onChangeText={onName} autoCapitalize="none" autoCorrect={false} placeholder={member.role}
          placeholderTextColor={t.dim} style={{ ...F.body(600), fontSize: 13.5, color: t.text, padding: 0, margin: 0 }} />
        <Text style={{ ...F.body(400), fontSize: 11, color: t.dim }}>{member.role}</Text>
      </View>
      <Text style={{ ...F.mono(500), fontSize: 10, color: t.muted }} numberOfLines={1}>{brain}</Text>
    </View>
  );
}

export function Reveal({ crew, ready }: { crew: ReadonlyArray<{ name: string; role: string }>; ready: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 12, paddingTop: 18, opacity: ready ? 1 : 0.55 }}>
      {crew.map((c) => (
        <View key={c.role} style={{ width: '33.3%', alignItems: 'center', paddingVertical: 10 }}>
          <View>
            <Tile label={c.name || c.role} size={48} round={false} />
            {ready ? <View style={{ position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: t.green, borderWidth: 2, borderColor: t.bg }} /> : null}
          </View>
          <Text style={{ ...F.body(600), fontSize: 12.5, color: t.text, marginTop: 6 }}>{c.name || c.role}</Text>
          <Text style={{ ...F.body(400), fontSize: 10.5, color: t.dim }}>{c.role}</Text>
        </View>
      ))}
    </View>
  );
}

export function Stats({ agents, machines, channels }: { agents: number; machines: number; channels: number }) {
  const t = useTheme();
  const fact = (n: number, word: string) => (
    <Text key={word} style={{ ...F.body(400), fontSize: 12, color: t.muted }}><Text style={{ ...F.body(600), color: t.text }}>{n}</Text> {word}</Text>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, paddingTop: 8 }}>
      {fact(agents, 'agents')}{fact(machines, machines === 1 ? 'cloud machine online' : 'cloud machines online')}{fact(channels, 'channels')}
    </View>
  );
}
