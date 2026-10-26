import { useSyncExternalStore } from "react";

/** A theme picked, or the system's, whichever it is. */
export type ThemeChoice = "light" | "dark" | "system";

const storageKey = "skjera-theme";

/** The theme picked, if any: index.html applies it before the first paint. */
const currentChoice = (): ThemeChoice => {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? chosen : "system";
};

/** Every part of the page showing the choice, told when it changes. */
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Picks a theme, or goes back to the system's, and remembers it. */
const choose = (choice: ThemeChoice) => {
  if (choice === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  try {
    if (choice === "system") localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, choice);
  } catch {
    // Private browsing: the choice lasts until the page is closed.
  }
  for (const listener of listeners) listener();
};

/** The theme picked ("system" if none), and a way to pick another. */
export function useThemeChoice() {
  const choice = useSyncExternalStore(subscribe, currentChoice);
  return { choice, pick: choose };
}
