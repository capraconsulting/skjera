import type { ReactNode } from "react";
import styles from "./Field.module.css";

export const fieldStyles = { field: styles.field, label: styles.label };

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
