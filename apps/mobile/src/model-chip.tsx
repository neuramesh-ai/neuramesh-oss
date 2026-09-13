// WHICH BRAIN IS WORKING (the mobile fix round, 2026-09-06; George: "it doesn't seem like I can
// select a model in the Code view on mobile").
//
// The open message has carried `modelId` since the Code bridge landed, and the desktop sets it from
// its own selector. The phone never did, so every session silently inherited the project's
// developer seat and no screen said which brain was on the job. This is that selector at phone
// width: the same groups (the house brain, then one per provider) from the SHARED catalog, and the
// same inherited default from the SHARED derivation, so a model the desktop names is the model the
// phone names.
//
// A provider you have not connected is VISIBLE and dimmed with the reason. Hiding it would answer
// "why is my model missing" with silence. A row says nothing under its name unless the line carries
// something the name does not (CLAUDE.md #11: delete the subtext, never shrink it).
import { CURRENT_MODELS, modelLabel, STARTER_MODEL, type Provider } from '@neuramesh/shared';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from './auth';
import { Icon } from './icon';
import { modelNote, modelReady } from './model-pick';
import { useTheme } from './theme';
import { ComposerChip } from './thread-parts';
import { F, R } from './type';

const GROUPS: ReadonlyArray<{ id: Provider | 'house'; name: string; models: readonly string[] }> = [
  { id: 'house', name: 'NeuraMesh', models: [STARTER_MODEL] },
  { id: 'anthropic', name: 'Claude', models: CURRENT_MODELS['claude-code'].filter((m) => m !== STARTER_MODEL) },
  { id: 'openai', name: 'ChatGPT', models: CURRENT_MODELS.codex.filter((m) => m !== STARTER_MODEL) },
  { id: 'gemini', name: 'Gemini', models: CURRENT_MODELS.gemini.filter((m) => m !== STARTER_MODEL) },
];

export function ModelChip({ workspace, value, inherited, onChange, disabled }: {
  workspace: string | null;
  /** the session's own pick, or null while it inherits */
  value: string | null;
  /** what it inherits when nothing is picked, so the chip is never blank and never guesses */
  inherited: string;
  onChange: (modelId: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [creds, setCreds] = useState<Array<{ provider: string }> | null>(null);
  useEffect(() => {
    if (!workspace || !open || creds) return;
    let alive = true;
    void api.credentials(workspace).then((r) => { if (alive) setCreds(r.credentials); }).catch(() => { if (alive) setCreds([]); });
    return () => { alive = false; };
  }, [workspace, open, creds]);
  const connected = useMemo(() => new Set((creds ?? []).map((c) => c.provider)), [creds]);
  const shown = value ?? inherited;

  return (
    <>
      <ComposerChip icon={<Icon name="brain" size={13} color={open ? t.text : t.muted} />} label={modelLabel(shown)} open={open} onPress={disabled ? undefined : () => setOpen(true)} />
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
          <Pressable onPress={() => {}} style={{ backgroundColor: t.overlay, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, borderTopWidth: 1, borderColor: t.border, paddingBottom: 30, maxHeight: '72%' }}>
            <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border2, marginTop: 10, marginBottom: 6 }} />
            <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, paddingHorizontal: 16, paddingBottom: 6 }}>Run this session on</Text>
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              {value ? (
                <Pressable onPress={() => { onChange(null); setOpen(false); }} style={{ paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, justifyContent: 'center' }}>
                  <Text style={{ ...F.body(600), fontSize: 13, color: t.link }}>Use the project&apos;s default ({modelLabel(inherited)})</Text>
                </Pressable>
              ) : null}
              {GROUPS.filter((g) => g.models.length).map((g) => (
                <View key={g.id}>
                  <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 }}>{g.name}</Text>
                  {g.models.map((m) => {
                    const ready = modelReady(m, connected);
                    const on = shown === m;
                    const note = modelNote(m, g.name, ready, m === inherited);
                    return (
                      <Pressable key={m} disabled={!ready} onPress={() => { onChange(m); setOpen(false); }}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11, minHeight: 46, opacity: ready ? 1 : 0.55, backgroundColor: on ? t.panel2 : 'transparent' }}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ ...F.body(600), fontSize: 13.5, color: t.text }}>{modelLabel(m)}</Text>
                          {note ? <Text style={{ ...F.body(400), fontSize: 11.5, color: t.dim, marginTop: 1 }} numberOfLines={1}>{note}</Text> : null}
                        </View>
                        {on ? <Icon name="check" size={14} color={t.link} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
