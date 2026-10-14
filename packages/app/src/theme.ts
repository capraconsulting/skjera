import { useState } from "react";

type Theme = "light" | "dark";

/** A theme picked, or the system's, whichever it is. */
export type ThemeChoice = Theme | "system";

const storageKey = "skjera-theme";

/** The theme picked, if any: index.html applies it before the first paint. */
const currentChoice = (): ThemeChoice => {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? chosen : "system";
};

/** The theme in effect: the user's choice, or else the system's. */
const currentTheme = (): Theme => {
  const chosen = currentChoice();
  if (chosen !== "system") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
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
};

/** The theme in effect, and a function that switches to the other one. */
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    choose(next);
    setTheme(next);
  };
  return { theme, toggle };
}

/** The theme picked ("system" if none), and a way to pick another. */
export function useThemeChoice() {
  const [choice, setChoice] = useState(currentChoice);
  const pick = (next: ThemeChoice) => {
    choose(next);
    setChoice(next);
  };
  return { choice, pick };
}
