import { m } from "@skjera/i18n/messages";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { type ThemeChoice, useThemeChoice } from "../theme.ts";
import { Dropdown, DropdownItem } from "./Dropdown.tsx";
import styles from "./ThemeMenu.module.css";

const icons = { light: Sun, dark: Moon, system: Monitor };

/** Picks the light or dark theme, or the system's, and remembers the choice. */
export function ThemeMenu() {
  const { choice, pick } = useThemeChoice();
  const themes: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
    { value: "light", label: m.account_theme_light() },
    { value: "dark", label: m.account_theme_dark() },
    { value: "system", label: m.account_theme_system() },
  ];
  const Current = icons[choice];
  return (
    <Dropdown
      label={m.account_theme()}
      trigger={{
        content: <Current size={16} strokeWidth={1.5} aria-hidden="true" />,
        className: undefined,
        buttonStyle: "icon",
      }}
    >
      {(close) =>
        themes.map(({ value, label }) => {
          const Icon = icons[value];
          return (
            <DropdownItem
              key={value}
              aria-pressed={value === choice}
              onClick={() => {
                pick(value);
                close();
              }}
            >
              <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
              <span className={styles.label}>{label}</span>
              {value === choice ? (
                <Check size={16} strokeWidth={1.5} aria-hidden="true" />
              ) : null}
            </DropdownItem>
          );
        })
      }
    </Dropdown>
  );
}
