import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './auth';
// the payload → route mapping lives in deeplink.ts (pure, tested); re-exported so the tap handlers keep one import
export { type DeepLink, type DeepLinkRoute, routeForData } from './deeplink';

// Push client. Registers this device's Expo token with the control-api (the
// /v1/devices endpoint) so the server fan-out can reach it, routes a tapped
// notification to the right thread, and re-registers when Expo rotates the token.
// Real delivery needs an EAS projectId + APNs key (the founder's Apple/EAS setup);
// the code + wiring are complete regardless.

// Foreground behavior: still surface gate/card banners while the app is open (the
// screens slice suppresses the one for the thread you're actively viewing).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const eas = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas;
  return eas?.projectId || undefined;
}

async function expoToken(): Promise<string> {
  const pid = projectId();
  const { data } = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined);
  return data;
}

// Register this device: fetch the Expo token and post it. The PROMPT is a separate decision
// (S7, D12 — asked after the first reply, never at cold start): with `prompt` off this only
// re-registers a device whose permission is already granted (the boot-time refresh); with it on
// it asks. Returns the token, or null when not granted / on a simulator (which can't receive push).
export async function registerForPush(opts: { prompt?: boolean } = {}): Promise<string | null> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'NeuraMesh',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    if (!opts.prompt || !existing.canAskAgain) return null;
    if ((await Notifications.requestPermissionsAsync()).status !== 'granted') return null;
  }
  // the permission is real on a simulator (so the ask and the banners can be driven there); the
  // push TOKEN is not — a simulator never reaches APNs, so there is nothing to register
  if (!Device.isDevice) return null;

  const token = await expoToken();
  // DEDUPE THE REGISTRATION. The tabs layout re-runs its effect on navigation and Expo can emit
  // repeat token-rotation events, so this used to POST /v1/devices many times a second on a busy
  // cold start. A serverless function answers each one on its own instance holding its own DB
  // connections, so the storm was one of the things that helped exhaust the pool. The server only
  // ever needs one POST per distinct token.
  if (token === lastRegisteredToken) return token;
  await api.registerDevice({
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    token,
    deviceName: Device.deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version ?? undefined,
  });
  lastRegisteredToken = token;
  return token;
}

// the last token we told the server about, so a re-fired effect is a no-op rather than a request
let lastRegisteredToken: string | null = null;

const ASKED_KEY = 'nm.push.asked';

// THE MOMENT TO ASK (S7): the first reply an agent gives you, or the first approval a Code session
// waits on — the point where "tell me when they need me" is the obvious next question, rather than
// a cold-start permission sheet nobody has a reason to accept yet. Once per install: a refusal is
// respected (iOS offers no second prompt anyway; Settings does), and a grant registers the device.
export async function askPushWhenItMatters(): Promise<void> {
  const asked = await SecureStore.getItemAsync(ASKED_KEY).catch(() => null);
  if (asked) return;
  await SecureStore.setItemAsync(ASKED_KEY, new Date().toISOString()).catch(() => {});
  await registerForPush({ prompt: true }).catch(() => {});
}

// On sign-out: stop the server pushing to this device. Best-effort — the server
// also prunes any token Expo later reports as DeviceNotRegistered.
export async function unregisterPush(): Promise<void> {
  lastRegisteredToken = null; // a later sign-in must register again
  try {
    await api.unregisterDevice(await expoToken());
  } catch {
    /* best effort */
  }
}

// Re-register whenever Expo rotates the token.
export function listenForTokenRotation(): ReturnType<typeof Notifications.addPushTokenListener> {
  return Notifications.addPushTokenListener(() => {
    void registerForPush();
  });
}
