import { m } from "@skjera/i18n/messages";
import { getLocale, isLocale } from "@skjera/i18n/runtime";
import { useId } from "react";
import { type LoaderFunctionArgs, useLoaderData } from "react-router";
import { displayName } from "../../components/UserMenu.tsx";
import { languages, setLocale } from "../../i18n.ts";
import { requireMe } from "../../site/client.ts";
import { type ThemeChoice, useThemeChoice } from "../../theme.ts";
import styles from "./Account.module.css";

export const accountLoader = ({ request }: LoaderFunctionArgs) =>
  requireMe(request);

/** The signed-in user's account: who they are, and how the site looks. */
export function Account() {
  const me = useLoaderData<typeof accountLoader>();
  const theme = useThemeChoice();
  const themes: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
    { value: "system", label: m.account_theme_system() },
    { value: "light", label: m.account_theme_light() },
    { value: "dark", label: m.account_theme_dark() },
  ];
  return (
    <div className={styles.account}>
      <h1 className={styles.heading}>{m.account_settings()}</h1>

      <Section title={m.account_profile()}>
        <dl className={styles.profile}>
          <div>
            <dt>{m.account_name()}</dt>
            <dd>{displayName(me)}</dd>
          </div>
          {me.email === undefined ? null : (
            <div>
              <dt>{m.account_email()}</dt>
              <dd>{me.email}</dd>
            </div>
          )}
        </dl>
        <p className={styles.hint}>{m.account_profile_hint()}</p>
      </Section>

      <Section title={m.common_language()}>
        <Choices
          name="language"
          value={getLocale()}
          options={languages.map((language) => ({
            value: language.locale,
            label: language.name,
            lang: language.locale,
          }))}
          // Reloads the page in it.
          onChange={(locale) => {
            if (isLocale(locale)) void setLocale(locale);
          }}
        />
        <p className={styles.hint}>{m.account_language_hint()}</p>
      </Section>

      <Section title={m.account_theme()}>
        <Choices
          name="theme"
          value={theme.choice}
          options={themes}
          onChange={(value) => theme.pick(value as ThemeChoice)}
        />
      </Section>
    </div>
  );
}

function Section(props: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.sectionHeading}>
        {props.title}
      </h2>
      {props.children}
    </section>
  );
}

/** One of a few, as radio buttons styled as pills. */
function Choices(props: {
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<{
    readonly value: string;
    readonly label: string;
    readonly lang?: string;
  }>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className={styles.choices} role="radiogroup">
      {props.options.map((option) => (
        <label key={option.value} className={styles.choice} lang={option.lang}>
          <input
            type="radio"
            name={props.name}
            value={option.value}
            checked={props.value === option.value}
            onChange={() => props.onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
