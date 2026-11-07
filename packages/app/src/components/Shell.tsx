import { appPaths } from "@skjera/paths";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { currentSite } from "../i18n.ts";
import { Footer } from "./Footer.tsx";
import { LanguagePicker } from "./LanguagePicker.tsx";
import { Logo } from "./Logo.tsx";
import styles from "./Shell.module.css";
import { ThemeMenu } from "./ThemeMenu.tsx";

/**
 * Page frame: the site's name (always to its front page) and any links on
 * the left; the language, the theme toggle and the actions (logging in, or
 * the user's menu) on the right.
 */
export function Shell(props: {
  readonly links?: ReactNode;
  readonly actions?: ReactNode;
  /** Fill the window below the header, for app-like layouts like the studio. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={props.fill ? styles.filled : undefined}>
      <header className={styles.header}>
        <div className={styles.bar}>
          <nav className={styles.nav}>
            <Link to={appPaths.root} className={styles.brand}>
              <Logo site={currentSite()} />
            </Link>
            {props.links}
          </nav>
          <div className={styles.actions}>
            <LanguagePicker />
            <ThemeMenu />
            {/* Logging in, or who's in: rightmost, where people look. */}
            {props.actions}
          </div>
        </div>
      </header>
      <main className={props.fill ? styles.fill : styles.main}>
        {props.children}
      </main>
      {/* The site's; the studio fills the window. */}
      {props.fill ? null : <Footer />}
    </div>
  );
}
