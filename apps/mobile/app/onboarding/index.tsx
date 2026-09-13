// THE ARRIVAL GATE (S6, D19): after sign-in, and on every cold start, decide where this person
// lands. An unfinished wizard resumes first (its workspace exists — a second one must never be
// minted); a membership in the replica goes straight to the tabs (offline-first, no round trip);
// otherwise the API answers: memberships → the tabs, an invitation → Invited, nothing → the wizard.
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from '../../src/auth';
import { Btn } from '../../src/kit';
import { readResume } from '../../src/onboard';
import { useTheme } from '../../src/theme';
import { F } from '../../src/type';

export default function Arrive() {
  const t = useTheme();
  const router = useRouter();
  // the ONE query that cannot be workspace-scoped, because it is what discovers which workspaces
  // you belong to — the same text the switcher reads (scripts/audit-workspace-scope.mjs exempts it
  // by its exact words, so this asks the question rather than inventing a second unscoped query)
  const { data: rows, isLoading } = useQuery<{ id: string }>('select distinct workspace_id as id from workspace_members');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const replicaHas = (rows ?? []).length > 0;

  useEffect(() => {
    if (isLoading) return;
    let alive = true;
    (async () => {
      const resume = await readResume();
      if (!alive) return;
      if (resume) { router.replace({ pathname: '/onboarding/wizard', params: { resume: resume.id, name: resume.name, slug: resume.slug } }); return; }
      if (replicaHas) { router.replace('/(tabs)'); return; }
      try {
        const { workspaces } = await api.workspaces();
        if (!alive) return;
        if (workspaces.length) { router.replace('/(tabs)'); return; }
        const invites = await api.myInvites().then((r) => r.invites).catch(() => []);
        if (!alive) return;
        router.replace(invites.length ? '/onboarding/invited' : '/onboarding/wizard');
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, replicaHas, attempt]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      {failed ? (
        <>
          <Text style={{ ...F.body(400), color: t.body, fontSize: 13.5, lineHeight: 20, textAlign: 'center' }}>NeuraMesh did not answer. Check your connection, then try again.</Text>
          <Btn label="Try again" onPress={() => { setFailed(false); setAttempt((n) => n + 1); }} style={{ marginTop: 16 }} />
        </>
      ) : <ActivityIndicator color={t.accent} />}
    </View>
  );
}
