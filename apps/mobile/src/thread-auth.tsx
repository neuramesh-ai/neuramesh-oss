// THE CREDENTIAL CARD ON THE PHONE (George, 2026-09-07: the card said "choose how to proceed:" and
// offered nothing to choose). The desktop has rendered this since the capacity-failover round; the
// phone never did, so `stripCards` dropped the fenced block and the reader hit a dead end.
//
// The rows follow the picker idiom (D13 — glyph · name · one-phrase explainer), and the first one
// is the option the block was withholding: RUN ON CREDITS. The refusal exists so nothing spends
// your money without you saying so, which makes an explicit tap exactly the right way out of it —
// the balance is on the row, so the spend is named before it happens.
//
// Choosing credits RE-SEATS THIS AGENT on the house brain (`agent.update`), which is the change the
// policy actually reads: decideAuth's platformModel is `agent.model === STARTER_MODEL`, and the
// starter lane also needs the gemini runtime, since the metered proxy only ever serves that model.
//
// It is NOT the workspace pack setting. `workspace.update {activeModelPack}` records the setting but
// materializes nothing — the desktop follows it with `applyPack`, which has no server-side twin, so
// from the phone that call would have looked like it worked and changed nothing the agent reads
// (caught on the simulator, 2026-09-08). Acting on the one agent the card is about is also the
// smaller claim: a card about rex should not silently re-brain everyone.
import { AUTH_LABEL, STARTER_MODEL, type NmAuth } from '@neuramesh/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View, type ViewStyle } from 'react-native';
import { api } from './auth';
import { useCompute } from './compute';
import { Icon } from './icon';
import { errMsg } from './onboard';
import { useTheme } from './theme';
import { F, R } from './type';
import { useActiveWorkspace } from './ui';

export function AuthCard({ auth, agentId }: { auth: NmAuth; agentId: string }) {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const compute = useCompute(ws);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const label = AUTH_LABEL[auth.provider] ?? auth.provider;
  // the same figure Compute prints, from the same field — the card must not disagree with it
  const left = compute.credits ? Math.max(0, compute.credits.credits.remaining).toLocaleString() : null;

  const card = {
    backgroundColor: t.card, borderWidth: 1, borderColor: t.cardBorder, borderRadius: R.lg,
    paddingHorizontal: 13, paddingTop: 11, paddingBottom: 12, marginTop: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  } as const;

  async function runOnCredits() {
    if (!agentId || busy) return;
    setBusy(true);
    setErr('');
    try {
      await api.command({ type: 'agent.update', agent: agentId, model: STARTER_MODEL, runtime: 'gemini' });
      setDone(true);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Confirmed who={auth.agent ? `@${auth.agent}` : 'The agent'} style={card} />;

  return (
    <View style={card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: t.warn }} />
        <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>{`${label} has no login here`}</Text>
      </View>
      <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 18, color: t.body, marginTop: 4, marginBottom: 10 }}>
        {auth.agent ? `@${auth.agent}` : 'The agent'} cannot {auth.taskNumber ? `run #${auth.taskNumber}` : 'reply'}. This machine has no {label} subscription login, and I do not spend your money on my own.
      </Text>

      <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: R.lg, overflow: 'hidden' }}>
        <Row
          glyph={<Icon name="check" size={13} color={t.green} />}
          title="Use NeuraMesh credits"
          hint={busy ? 'Please wait…' : 'runs on the Starter brain'}
          trail={left ? <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.green }}>{`${left} left`}</Text> : null}
          tone={t.panel2}
          onPress={() => void runOnCredits()}
          disabled={busy}
        />
        <View style={{ height: 1, backgroundColor: t.border }} />
        <Row
          glyph={<Icon name="code" size={13} color={t.muted} />}
          title="Sign in on the machine"
          hint="open Compute, then Terminal"
          trail={<Icon name="chevron" size={12} color={t.dim} />}
          onPress={() => router.push('/compute')}
        />
      </View>

      {err ? <Text style={{ ...F.body(400), fontSize: 11.5, color: t.warn, marginTop: 8 }}>{err}</Text> : null}
      {/* the API-key route is real but it is a DESKTOP surface (provider settings), so the phone
          names where it lives rather than offering a row that goes nowhere — the same honesty the
          permission card uses for workspace policy */}
      <Text style={{ ...F.body(400), fontSize: 11, lineHeight: 16, color: t.dim, marginTop: 8 }}>
        To use an API key instead, open provider settings on the desktop.
      </Text>
    </View>
  );
}

/** the card after you choose credits: what changed, and where to change it back */
function Confirmed({ who, style }: { who: string; style: ViewStyle }) {
  const t = useTheme();
  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="check" size={13} color={t.green} />
        <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>On NeuraMesh credits</Text>
      </View>
      <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 18, color: t.muted, marginTop: 4 }}>
        {who} now runs on the NeuraMesh Starter brain. Send your message again.
      </Text>
      <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 7 }}>
        Change the brain any time from this agent&apos;s settings.
      </Text>
    </View>
  );
}

function Row({ glyph, title, hint, trail, tone, onPress, disabled }: {
  glyph: React.ReactNode; title: string; hint: string; trail?: React.ReactNode;
  tone?: string; onPress: () => void; disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, paddingVertical: 10,
        backgroundColor: pressed ? t.panel3 : (tone ?? t.card), opacity: disabled ? 0.6 : 1,
      })}
    >
      <View style={{ width: 22, height: 22, borderRadius: R.md, backgroundColor: t.panel3, alignItems: 'center', justifyContent: 'center' }}>{glyph}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...F.body(500), fontSize: 12.5, color: t.text }} numberOfLines={1}>{title}</Text>
        <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, marginTop: 1 }} numberOfLines={1}>{hint}</Text>
      </View>
      {trail}
    </Pressable>
  );
}
