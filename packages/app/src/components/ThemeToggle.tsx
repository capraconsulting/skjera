import { m } from "@skjera/i18n/messages";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme.ts";
import { Button } from "./Button.tsx";

/** Switches between the light and dark theme, and remembers the choice. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const label =
    theme === "dark" ? m.theme_switch_light() : m.theme_switch_dark();
  return (
    <Button icon onClick={toggle} aria-label={label} title={label}>
      {theme === "dark" ? (
        <Sun size={16} strokeWidth={1.5} aria-hidden="true" />
      ) : (
        <Moon size={16} strokeWidth={1.5} aria-hidden="true" />
      )}
    </Button>
  );
}
