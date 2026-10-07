import { m } from "@skjera/i18n/messages";
import { Link } from "react-router";
import { currentSite } from "../i18n.ts";
import styles from "./Footer.module.css";

/**
 * Under the site's pages: its links (SITE_FOOTER), as logos or words, its
 * line of text, and privacy (ours, or SITE_PRIVACY_URL's).
 */
export function Footer() {
  const { footer, privacy } = currentSite();
  return (
    <footer className={styles.footer}>
      {footer?.links === undefined || footer.links.length === 0 ? null : (
        <ul className={styles.links}>
          {footer.links.map((link) => (
            <li key={link.href}>
              <a href={link.href} className={styles.link}>
                {link.logo === undefined ? (
                  link.label
                ) : (
                  <>
                    <img
                      className={
                        link.logo.darkSrc === undefined
                          ? styles.logo
                          : styles.light
                      }
                      src={link.logo.src}
                      alt={link.label}
                    />
                    {link.logo.darkSrc === undefined ? null : (
                      <img
                        className={styles.dark}
                        src={link.logo.darkSrc}
                        alt={link.label}
                      />
                    )}
                  </>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.line}>
        {footer?.text === undefined ? null : (
          <span className={styles.text}>{footer.text}</span>
        )}
        {privacy.url === undefined ? (
          <Link to="/privacy">{m.privacy_title()}</Link>
        ) : (
          <a href={privacy.url}>{m.privacy_title()}</a>
        )}
      </p>
    </footer>
  );
}
