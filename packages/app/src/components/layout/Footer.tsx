import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { appPaths } from "@skjera/paths";
import { Fragment } from "react";
import { Link } from "react-router";
import { currentSite } from "../../i18n.ts";
import styles from "./Footer.module.css";
import { footerView, type LinePiece } from "./footerView.ts";

/** A logo: one image, or a light and a dark one swapped with the theme. */
function LogoImage({
  label,
  src,
  darkSrc,
  className,
}: {
  label: string;
  src: string;
  darkSrc?: string | undefined;
  className?: string | undefined;
}) {
  const sized = (own: string | undefined) =>
    [own, className].filter(Boolean).join(" ");
  return (
    <>
      <img
        className={sized(darkSrc === undefined ? styles.logo : styles.light)}
        src={src}
        alt={label}
      />
      {darkSrc === undefined ? null : (
        <img className={sized(styles.dark)} src={darkSrc} alt={label} />
      )}
    </>
  );
}

/** The line of text: words, and the addresses in it as links. */
function Line({ pieces }: { pieces: ReadonlyArray<LinePiece> }) {
  let offset = 0;
  return pieces.map((piece) => {
    const key = offset;
    offset += piece.text.length;
    return (
      <Fragment key={key}>
        {piece.href === undefined ? (
          piece.text
        ) : (
          <a href={piece.href}>{piece.text}</a>
        )}
      </Fragment>
    );
  });
}

/**
 * Under the site's pages: its heading, groups of logos and links
 * (SITE_FOOTER), privacy (ours, or SITE_PRIVACY_URL's) and its line of text.
 */
export function Footer() {
  const { footer, privacy } = currentSite();
  const view = footerView(footer, getLocale(), new Date().getFullYear());
  const privacyLink =
    privacy.url === undefined ? (
      <Link to={appPaths.privacy}>{m.privacy_title()}</Link>
    ) : (
      <a href={privacy.url}>{m.privacy_title()}</a>
    );
  const links =
    view.links.length === 0 ? null : (
      <ul className={styles.links}>
        {view.links.map((link) => (
          <li key={link.href}>
            <a href={link.href} className={styles.link}>
              {link.logo === undefined ? (
                link.label
              ) : (
                <LogoImage
                  label={link.label}
                  src={link.logo.src}
                  darkSrc={link.logo.darkSrc}
                />
              )}
            </a>
          </li>
        ))}
      </ul>
    );
  const heading =
    view.heading === undefined ? null : (
      <p className={styles.heading}>{view.heading}</p>
    );

  if (view.privacyInRow) {
    return (
      <footer className={styles.footer}>
        {heading}
        <div className={styles.row}>
          {view.groups.map((group) => (
            <div
              key={group.logos.map((logo) => logo.src).join()}
              className={styles.group}
            >
              {group.title === undefined ? null : (
                <p className={styles.title}>{group.title}</p>
              )}
              <ul className={styles.groupLogos}>
                {group.logos.map((logo) => {
                  const image = (
                    <LogoImage
                      label={logo.label}
                      src={logo.src}
                      darkSrc={logo.darkSrc}
                      className={
                        group.title === undefined
                          ? styles.company
                          : styles.certification
                      }
                    />
                  );
                  return (
                    <li key={logo.src}>
                      {logo.href === undefined ? (
                        image
                      ) : (
                        <a href={logo.href} className={styles.link}>
                          {image}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {links}
          <span className={styles.privacy}>{privacyLink}</span>
        </div>
        {view.line.length === 0 ? null : (
          <p className={styles.rowText}>
            <Line pieces={view.line} />
          </p>
        )}
      </footer>
    );
  }

  return (
    <footer className={styles.footer}>
      {heading}
      {links}
      <p className={styles.line}>
        {view.line.length === 0 ? null : (
          <span className={styles.text}>
            <Line pieces={view.line} />
          </span>
        )}
        {privacyLink}
      </p>
    </footer>
  );
}
