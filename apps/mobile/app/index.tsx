import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { loadSession, type Session } from '../src/auth';
import { useTheme } from '../src/theme';

// Auth gate: signed in → the arrival gate (memberships · invitations · the wizard, S6), else sign-in.
export default function Index() {
  const t = useTheme();
  const [state, setState] = useState<{ loading: boolean; session: Session | null }>({ loading: true, session: null });

  useEffect(() => {
    loadSession().then((session) => setState({ loading: false, session }));
  }, []);

  if (state.loading) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }
  return <Redirect href={state.session ? '/onboarding' : '/sign-in'} />;
}
