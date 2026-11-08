import { m } from "@skjera/i18n/messages";
import { getLocale, isLocale } from "@skjera/i18n/runtime";
import { ChevronDown, Globe } from "lucide-react";
import { languages, setLocale } from "../../i18n.ts";
import { Select } from "../controls/Input.tsx";
import styles from "./LanguagePicker.module.css";

/**
 * Picks the interface's language; the page reloads in it. A native select,
 * dressed as the pills beside it.
 */
export function LanguagePicker() {
  return (
    <span className={styles.picker}>
      <Globe
        className={styles.globe}
        size={16}
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <Select
        className={styles.select}
        aria-label={m.common_language()}
        title={m.common_language()}
        value={getLocale()}
        onChange={(event) => {
          const locale = event.currentTarget.value;
          if (isLocale(locale)) void setLocale(locale);
        }}
      >
        {languages.map((language) => (
          <option
            key={language.locale}
            value={language.locale}
            lang={language.locale}
          >
            {language.name}
          </option>
        ))}
      </Select>
      <ChevronDown
        className={styles.chevron}
        size={14}
        strokeWidth={1.5}
        aria-hidden="true"
      />
    </span>
  );
}
