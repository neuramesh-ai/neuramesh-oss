import * as Notifications from 'expo-notifications';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../src/connection';
import { Icon } from '../../src/icon';
import { type DeepLink, listenForTokenRotation, registerForPush, routeForData } from '../../src/push';
import { useTheme } from '../../src/theme';
import { F } from '../../src/type';

// THE TAB BAR IS THE RAIL'S MODE SWITCH (the mobile-cloud round, D1): Home is Chat mode's list,
// Code the Code mode (S5), Routines the automations (S4), Tasks the board. Team retired here — "what a
// machine is serving" is each machine's card on Compute, reached from the head's pill.
export default function TabsLayout() {
  const t = useTheme();
  const router = useRouter();

  // The PowerSync provider + sync bootstrap live in the root layout (app/_layout.tsx)
  // so every route shares one connected replica. This layout owns the tab UI + push.

  // push: refresh a granted device's registration (the PROMPT waits for the first reply — S7),
  // follow taps to the surface each push names, re-register on rotation
  useEffect(() => {
    void registerForPush();
    const rotation = listenForTokenRotation();
    const tap = Notifications.addNotificationResponseReceivedListener((response) => {
      const path = routeForData(response.notification.request.content.data as DeepLink);
      if (path) router.push(path);
    });
    // a tap that cold-started the app
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      const path = response ? routeForData(response.notification.request.content.data as DeepLink) : null;
      if (path) router.push(path);
    });
    return () => {
      rotation.remove();
      tap.remove();
    };
  }, [router]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <OfflineBanner />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: t.text,
          tabBarInactiveTintColor: t.dim,
          tabBarStyle: { backgroundColor: t.panel, borderTopColor: t.border, borderTopWidth: 1 },
          tabBarLabelStyle: { ...F.body(500), fontSize: 10.5 },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Icon name="home" size={size ?? 22} color={color} /> }} />
        {/* THREADS sits second, before Code (George, 2026-09-08). It holds the session list Home
            used to draw, so it is the tab you reach for most after Home itself. */}
        <Tabs.Screen name="threads" options={{ title: 'Threads', tabBarIcon: ({ color, size }) => <Icon name="threads" size={size ?? 22} color={color} /> }} />
        <Tabs.Screen name="code" options={{ title: 'Code', tabBarIcon: ({ color, size }) => <Icon name="code" size={size ?? 22} color={color} /> }} />
        <Tabs.Screen name="routines" options={{ title: 'Routines', tabBarIcon: ({ color, size }) => <Icon name="routineClock" size={size ?? 22} color={color} /> }} />
        <Tabs.Screen name="board" options={{ title: 'Tasks', tabBarIcon: ({ color, size }) => <Icon name="board" size={size ?? 22} color={color} /> }} />
      </Tabs>
    </SafeAreaView>
  );
}
