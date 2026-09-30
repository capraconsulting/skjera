import type { ReactNode } from "react";
import styles from "./Pane.module.css";

/** A column of the studio: a header with a title and actions, then content that scrolls on its own. */
export function Pane(props: {
  readonly title: ReactNode;
  readonly actions?: ReactNode;
  /** Accessible name of the column. */
  readonly label: string;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className={styles.pane} aria-label={props.label}>
      <header className={styles.header}>
        <h2 className={styles.title}>{props.title}</h2>
        {props.actions}
      </header>
      <div className={styles.body}>{props.children}</div>
      {props.footer}
    </section>
  );
}

/** Fills columns that have nothing selected yet. */
export function PanePlaceholder(props: {
  readonly children: ReactNode;
  /** How many columns it spans, counted from where it starts. */
  readonly span?: number;
}) {
  return (
    <div
      className={styles.placeholder}
      style={{ gridColumn: `span ${props.span ?? 1}` }}
    >
      {props.children}
    </div>
  );
}
