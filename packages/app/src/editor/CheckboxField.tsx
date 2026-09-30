import type { EventContent } from "@skjera/documents/api";
import { useSyncExternalStore } from "react";
import styles from "./CheckboxField.module.css";
import type { LocalDocHandle } from "./LocalDocHandle.ts";

type BooleanField = "public" | "guests";

/** The current value of a true/false field, following changes from anyone. */
export const useBooleanField = (
  handle: LocalDocHandle<EventContent>,
  field: BooleanField,
) =>
  useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => handle.doc()[field] === true,
  );

/**
 * A collaborative checkbox. The value is a plain Automerge boolean: when two
 * people change it at once, one of the values wins.
 */
export function CheckboxField(props: {
  readonly handle: LocalDocHandle<EventContent>;
  readonly field: BooleanField;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
}) {
  const checked = useBooleanField(props.handle, props.field);
  return (
    <label
      className={
        props.disabled ? `${styles.field} ${styles.disabled}` : styles.field
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={props.disabled}
        onChange={(event) => {
          const value = event.target.checked;
          props.handle.change((doc) => {
            (doc as Record<BooleanField, boolean>)[props.field] = value;
          });
        }}
      />
      <span>
        <span className={styles.label}>{props.label}</span>
        {props.hint === undefined ? null : (
          <span className={styles.hint}>{props.hint}</span>
        )}
      </span>
    </label>
  );
}
