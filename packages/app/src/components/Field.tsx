import type { ReactNode } from "react";
import styles from "./Field.module.css";

/** A form field: its label above the input. */
export function Field(props: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{props.label}</span>
      {props.children}
    </div>
  );
}
