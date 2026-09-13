import { PowerSyncContext } from '@powersync/react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { useAppFonts } from '../src/fonts';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSession } from '../src/auth';
import { connect, getDb } from '../src/system';
import { ThemeProvider } from '../src/theme';
import { WorkspaceProvider } from '../src/workspace';

// the splash holds until the faces are registered: a first paint in the system font that
// then re-flows into Geist is the flash of unstyled text, on a phone
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const fontsReady = useAppFonts();
  useEffect(() => {
    if (fontsReady) void SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);
  // One PowerSync database for the whole app. The provider lives at the root so
  // every route — the tabs AND pushed detail screens (task/[id], channel/[id]) —
  // reads the same connected replica; scoping it to the tabs layout left those
  // detail screens outside the context, reading an empty db.
  const db = useMemo(() => getDb(), []);

  // Reconnect the sync stream on cold start with an existing session. Here (not in
  // the tabs layout) so a push deep-link that cold-starts straight into /task/[id]
  // — which never mounts the tabs — still starts syncing.
  useEffect(() => {
    void loadSession().then((session) => {
      if (session) void connect(session).catch(() => {});
    });
  }, []);

  if (!fontsReady) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <ThemeProvider>
        <PowerSyncContext.Provider value={db}>
          {/* INSIDE the PowerSync provider: the workspace list is read from the replica
              (workspace_members), with names filled in from the API (0113). */}
          <WorkspaceProvider>
            <Stack screenOptions={{ headerShown: false }}>
              {/* the review reminder lands on a SHEET, so the screen it opens over stays visible.
                  `presentation` is read when the screen mounts, so it is declared here rather than
                  from inside the route. */}
              <Stack.Screen name="post/[id]" options={{ presentation: 'transparentModal', animation: 'fade' }} />
            </Stack>
          </WorkspaceProvider>
        </PowerSyncContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
