import { Stack } from 'expo-router';

// the first-run screens (S6): the arrival gate, the invitation, the wizard — headerless, like the tabs
export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
