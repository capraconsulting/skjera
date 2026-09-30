import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./Shell.module.css";
import { ThemeToggle } from "./ThemeToggle.tsx";

/**
 * Page frame: "Skjera" (always to the site's front page) and any links on the
 * left, actions and the theme toggle on the right.
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
            <Link to="/" className={styles.brand}>
              Skjera
            </Link>
            {props.links}
          </nav>
          <div className={styles.actions}>
            {props.actions}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className={props.fill ? styles.fill : styles.main}>
        {props.children}
      </main>
    </div>
  );
}
