import { useState } from "react";

export type Theme = "light" | "dark";

const storageKey = "skjera-theme";

/** The theme in effect: the user's choice, or else the system's. */
const currentTheme = (): Theme => {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

/** The theme in effect, and a function that switches to the other one. */
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Private browsing: the choice lasts until the page is closed.
    }
    setTheme(next);
  };
  return { theme, toggle };
}
