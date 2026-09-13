// The phone bundles the desktop's two faces (the Foundry system, docs/33 §5): NeuraMesh Sans for
// UI and display, Geist Mono for kickers, chips, facts, buttons, code and the terminal. The sans
// is the house face, packages/fonts: the same build the desktop and the site load as woff2, cut
// to three static TTFs here because expo-font registers each weight under its own family name,
// which is why `type.ts` composes the name from weight rather than setting fontWeight (iOS ignores
// fontWeight on a custom family and falls back to the system face). The mono still comes from
// the Google-Fonts package. Three cuts each: the desktop folded its 700 and 800 to 600 and its
// display cuts to 500, so nothing heavier ships.
import { GeistMono_400Regular, GeistMono_500Medium, GeistMono_600SemiBold } from '@expo-google-fonts/geist-mono';
import NeuraMeshSans_400Regular from '@neuramesh/fonts/files/NeuraMeshSans-Regular.ttf';
import NeuraMeshSans_500Medium from '@neuramesh/fonts/files/NeuraMeshSans-Medium.ttf';
import NeuraMeshSans_600SemiBold from '@neuramesh/fonts/files/NeuraMeshSans-SemiBold.ttf';
import { useFonts } from 'expo-font';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    NeuraMeshSans_400Regular, NeuraMeshSans_500Medium, NeuraMeshSans_600SemiBold,
    GeistMono_400Regular, GeistMono_500Medium, GeistMono_600SemiBold,
  });
  // a font that failed to register must not hold the app: the system face is the honest fallback
  return loaded || !!error;
}
