import { m } from "@skjera/i18n/messages";
import type { ReactNode } from "react";
import { currentSite } from "../../i18n.ts";
import styles from "./Privacy.module.css";

/**
 * What personal data the site keeps, why, and who to ask: the operator
 * (SITE_OPERATOR) and their address (SITE_CONTACT_EMAIL). Written for what
 * Skjera does; keep it so when that changes.
 */
export function Privacy() {
  const { name, privacy } = currentSite();
  const contact =
    privacy.contact === undefined ? (
      m.privacy_ask_operator({ operator: privacy.operator })
    ) : (
      <>
        {m.privacy_contact()}{" "}
        <a href={`mailto:${privacy.contact}`}>{privacy.contact}</a>.
      </>
    );
  return (
    <article className={styles.privacy}>
      <h1 className={styles.heading}>{m.privacy_title()}</h1>
      <p className={styles.lead}>
        {m.privacy_intro({ operator: privacy.operator, site: name })}
      </p>

      <Part title={m.privacy_collect_heading()}>
        <ul>
          <li>{m.privacy_collect_login()}</li>
          <li>{m.privacy_collect_signup()}</li>
          <li>{m.privacy_collect_editing()}</li>
        </ul>
      </Part>
      <Part title={m.privacy_why_heading()}>
        <p>{m.privacy_why()}</p>
      </Part>
      <Part title={m.privacy_who_heading()}>
        <p>{m.privacy_who()}</p>
      </Part>
      <Part title={m.privacy_keep_heading()}>
        <p>{m.privacy_keep()}</p>
      </Part>
      <Part title={m.privacy_cookies_heading()}>
        <p>{m.privacy_cookies()}</p>
      </Part>
      <Part title={m.privacy_rights_heading()}>
        <p>
          {m.privacy_rights()} {contact}
        </p>
      </Part>
    </article>
  );
}

function Part(props: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className={styles.part}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  );
}
