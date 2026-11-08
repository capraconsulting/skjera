import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { BooleanEventField, EventContent } from "@skjera/documents/api";
import { useSyncExternalStore } from "react";
import styles from "./CheckboxField.module.css";

export const checkboxFieldStyles = {
  hint: styles.hint,
  label: styles.label,
};

/** The current value of a true/false field, following changes from anyone. */
export const useBooleanField = (
  handle: DocHandle<EventContent>,
  field: BooleanEventField,
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
  readonly handle: DocHandle<EventContent>;
  readonly field: BooleanEventField;
  readonly label: string;
  readonly hint?: string;
  /** Can't be changed, and shows off: the draft keeps its value for later. */
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
        checked={checked && props.disabled !== true}
        disabled={props.disabled}
        onChange={(event) => {
          const value = event.target.checked;
          props.handle.change((doc) => {
            (doc as Record<BooleanEventField, boolean>)[props.field] = value;
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
