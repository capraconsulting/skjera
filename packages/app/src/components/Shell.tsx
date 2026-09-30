import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "./Shell.module.css";

/** Page frame with a header: brand and links on the left, actions on the right. */
export function Shell(props: {
  readonly brand: { readonly to: string; readonly label: string };
  readonly links?: ReactNode;
  readonly actions: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          <Link to={props.brand.to} className={styles.brand}>
            {props.brand.label}
          </Link>
          {props.links}
        </nav>
        <div className={styles.actions}>{props.actions}</div>
      </header>
      <main>{props.children}</main>
    </div>
  );
}
