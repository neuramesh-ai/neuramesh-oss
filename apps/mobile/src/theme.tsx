import { THEMES, type Theme, type ThemeName } from '@neuramesh/client-core';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

// Ember Weave theming for RN, sourced from @neuramesh/client-core tokens (kept in
// parity with the desktop tokens.css by a CI test). 'system' follows the OS; the
// four named themes pin a choice, persisted across launches.
export type ThemeChoice = 'system' | ThemeName;

const ThemeCtx = createContext<Theme>(THEMES.dark);
const ChoiceCtx = createContext<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void }>({ choice: 'system', setChoice: () => {} });

export function useTheme(): Theme {
  return useContext(ThemeCtx);
}
export function useThemeChoice() {
  return useContext(ChoiceCtx);
}

const CHOICE_KEY = 'nm.theme';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const [choice, setChoiceState] = useState<ThemeChoice>('system');

  useEffect(() => {
    SecureStore.getItemAsync(CHOICE_KEY).then((v) => {
      if (v === 'system' || v === 'dark' || v === 'light' || v === 'soft-dark' || v === 'cream-oak') setChoiceState(v);
    });
  }, []);

  const setChoice = useCallback((c: ThemeChoice) => {
    setChoiceState(c);
    void SecureStore.setItemAsync(CHOICE_KEY, c);
  }, []);

  const name: ThemeName = choice === 'system' ? (scheme === 'light' ? 'light' : 'dark') : choice;
  return (
    <ChoiceCtx.Provider value={{ choice, setChoice }}>
      <ThemeCtx.Provider value={THEMES[name]}>{children}</ThemeCtx.Provider>
    </ChoiceCtx.Provider>
  );
}
