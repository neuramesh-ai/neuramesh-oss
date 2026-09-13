// The nmq question card on the phone — the one elevated object in a message (docs/33 §3; the
// mobile-cloud round D5): a mono kicker, the question, the options as ghost pills (a block when an
// option explains itself), the pill field for a typed answer with the round brand send. Tapping an
// option answers at once; multi-question cards step. Submitting posts `**question** → answer`
// lines — the answered-state store the desktop and the server both read.
import { formatCardAnswer, type NmQuestion } from '@neuramesh/shared';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Icon } from './icon';
import { useTheme } from './theme';
import { F, R } from './type';

export function QuestionCard({ questions, answers, onAnswer }: { questions: NmQuestion[]; answers: Map<string, string>; onAnswer: (text: string) => void }) {
  const t = useTheme();
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);

  // A policy gate that resolved to ask/deny renders as a permission card. Policy is edited on the
  // desktop (Workspace settings → Policy), so the phone says where to loosen a too-tight rule.
  const isPermission = questions.some((x) => x.kind === 'permission');
  const policyHint = isPermission ? (
    <Text style={{ ...F.body(400), color: t.dim, fontSize: 11, marginTop: 8, paddingTop: 7, borderTopWidth: 1, borderTopColor: t.border }}>
      Change this in the workspace policy, on the desktop under Settings → Policy.
    </Text>
  ) : null;
  const card = { backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg, paddingHorizontal: 13, paddingTop: 11, paddingBottom: 12, marginTop: 8, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } } as const;

  const answeredAll = questions.every((q) => answers.has(q.question));
  if (sent || answeredAll) {
    return (
      <View style={card}>
        {questions.map((q, i) => (
          <View key={q.question} style={{ flexDirection: 'row', gap: 8, paddingVertical: 2, alignItems: 'center' }}>
            <Icon name="check" size={13} color={t.done} />
            <Text style={{ ...F.body(400), color: t.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>{q.question}</Text>
            <Text style={{ ...F.body(600), color: t.text, fontSize: 12 }} numberOfLines={1}>{answers.get(q.question) ?? picked[i] ?? ''}</Text>
          </View>
        ))}
        {policyHint}
      </View>
    );
  }

  const q = questions[Math.min(idx, questions.length - 1)]!;
  const last = idx >= questions.length - 1;
  const current = picked[idx] ?? '';
  const submit = (answer: string) => {
    const a = answer.trim();
    if (!a) return;
    const final = { ...picked, [idx]: a };
    setPicked(final);
    setOther('');
    if (!last) {
      setIdx(idx + 1);
      return;
    }
    setSent(true);
    onAnswer(formatCardAnswer(questions.map((x, i) => ({ question: x.question, answer: final[i] ?? '' }))));
  };
  const kicker = isPermission ? `permission${q.risk === 'high' ? ' · high' : ''} · needs you` : questions.length > 1 ? `question ${idx + 1} of ${questions.length} · needs you` : 'question · needs you';

  return (
    <View style={card}>
      <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, marginBottom: 6 }}>{kicker}</Text>
      <Text style={{ ...F.body(600), color: t.text, fontSize: 13, lineHeight: 19, marginBottom: 8 }}>{q.title ?? q.question}</Text>
      {q.summary ? <Text style={{ ...F.body(400), color: t.body, fontSize: 12.5, lineHeight: 18, marginTop: -4, marginBottom: 8 }}>{q.summary}</Text> : null}
      {q.command ? (
        <ScrollView horizontal style={{ backgroundColor: t.bg, borderRadius: R.md, marginBottom: 8 }} contentContainerStyle={{ padding: 9 }}>
          <Text style={{ ...F.mono(500), color: t.body, fontSize: 11 }}>{q.command}</Text>
        </ScrollView>
      ) : null}
      {q.kind === 'permission' && q.reason ? <Text style={{ ...F.body(400), color: t.dim, fontSize: 11, marginTop: -2, marginBottom: 8 }}>{q.reason}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(q.options ?? []).map((o) => {
          const on = current === o.label;
          const block = !!o.description;
          return (
            <Pressable key={o.label} onPress={() => submit(o.label)}
              style={{ borderWidth: 1, borderColor: on ? t.text : t.border2, backgroundColor: on ? t.panel2 : 'transparent', borderRadius: block ? R.md : R.pill, paddingHorizontal: 12, paddingVertical: block ? 8 : 6, minHeight: 32, justifyContent: 'center', width: block ? '100%' : undefined }}>
              <Text style={{ ...F.body(500), color: on ? t.text : t.body, fontSize: 12 }}>{o.label}</Text>
              {o.description ? <Text style={{ ...F.body(400), color: t.dim, fontSize: 11, marginTop: 1 }}>{o.description}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {q.allowOther !== false ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, borderWidth: 1, borderColor: t.border, borderRadius: R.md, paddingLeft: 12, paddingRight: 4, paddingVertical: 4, backgroundColor: t.card }}>
          <TextInput value={other} onChangeText={setOther} onSubmitEditing={() => submit(other)} returnKeyType="send" placeholder="Or type your answer…" placeholderTextColor={t.dim}
            style={{ ...F.body(400), flex: 1, fontSize: 12.5, color: t.text, paddingVertical: 4 }} />
          <Pressable disabled={!other.trim()} onPress={() => submit(other)} accessibilityLabel={last ? 'Send' : 'Next'} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: other.trim() ? t.brand : t.panel3, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={last ? 'arrowUp' : 'arrowR'} size={15} color={other.trim() ? t.brandInk : t.dim} />
          </Pressable>
        </View>
      ) : null}
      {questions.length > 1 && idx > 0 ? (
        <Pressable onPress={() => setIdx(idx - 1)} hitSlop={6} style={{ alignSelf: 'flex-start', marginTop: 8 }}>
          <Text style={{ ...F.body(600), color: t.muted, fontSize: 12 }}>‹ Back</Text>
        </Pressable>
      ) : null}
      {policyHint}
    </View>
  );
}
