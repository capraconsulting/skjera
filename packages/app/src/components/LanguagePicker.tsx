import { m } from "@skjera/i18n/messages";
import { getLocale, isLocale } from "@skjera/i18n/runtime";
import { languages, setLocale } from "../i18n.ts";
import styles from "./LanguagePicker.module.css";

/** Picks the interface's language; the page reloads in it. */
export function LanguagePicker() {
  return (
    <select
      className={styles.picker}
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
    </select>
  );
}
