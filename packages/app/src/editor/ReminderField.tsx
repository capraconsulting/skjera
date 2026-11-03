import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import {
  type EventContent,
  type ReminderChoice,
  reminderChoice,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useSyncExternalStore } from "react";
import inputStyles from "../components/Input.module.css";
import styles from "./CheckboxField.module.css";

const choices: Record<ReminderChoice, () => string> = {
  default: () => m.studio_remind_default(),
  on: () => m.studio_remind_on(),
  off: () => m.studio_remind_off(),
};

/**
 * Whether those signed up are reminded the morning before: by whether
 * guests can sign up, always or never. A draft with none, or from before
 * there was a choice, reads as it publishes (see `reminderChoice`).
 */
export function ReminderField(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { handle } = props;
  const choice = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => reminderChoice(handle.doc().reminders),
  );
  return (
    <div>
      <div className={styles.label}>{m.studio_remind()}</div>
      <select
        aria-label={m.studio_remind()}
        className={inputStyles.input}
        value={choice}
        onChange={(event) => {
          const value = event.currentTarget.value;
          handle.change((doc) => {
            (doc as unknown as { reminders?: A.ImmutableString }).reminders =
              new A.ImmutableString(value);
          });
        }}
      >
        {Object.entries(choices).map(([each, label]) => (
          <option key={each} value={each}>
            {label()}
          </option>
        ))}
      </select>
      <span className={styles.hint}>{m.studio_remind_hint()}</span>
    </div>
  );
}
