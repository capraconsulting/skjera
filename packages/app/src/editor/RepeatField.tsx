import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent, RepeatUnit } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useSyncExternalStore } from "react";
import inputStyles from "../components/Input.module.css";
import { useBooleanField } from "./CheckboxField.tsx";
import styles from "./RepeatField.module.css";

const everyChoices = [1, 2, 3, 4, 5, 6, 7];

const units: Record<RepeatUnit, (count: number) => string> = {
  day: (count) => m.studio_repeat_day({ count }),
  week: (count) => m.studio_repeat_week({ count }),
  month: (count) => m.studio_repeat_month({ count }),
  year: (count) => m.studio_repeat_year({ count }),
};

/**
 * How often a recurring event comes back, while it does: a number from 1
 * to 7 and a unit. A draft with neither means every 1 week, which is what
 * the selects show.
 */
export function RepeatField(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { handle } = props;
  const recurring = useBooleanField(handle, "recurring");
  const subscribe = (onChange: () => void) => {
    handle.on("change", onChange);
    return () => handle.off("change", onChange);
  };
  const every = useSyncExternalStore(
    subscribe,
    () => handle.doc().repeatEvery ?? 1,
  );
  const unit = useSyncExternalStore(subscribe, () =>
    String(handle.doc().repeatUnit ?? "week"),
  ) as RepeatUnit;
  if (!recurring) return null;
  return (
    <div className={styles.repeat}>
      <select
        aria-label={m.studio_repeat_every()}
        className={inputStyles.input}
        value={every}
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          handle.change((doc) => {
            (doc as { repeatEvery?: number }).repeatEvery = value;
          });
        }}
      >
        {everyChoices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
      <select
        aria-label={m.studio_repeat_unit()}
        className={inputStyles.input}
        value={unit}
        onChange={(event) => {
          const value = event.currentTarget.value;
          handle.change((doc) => {
            (doc as unknown as { repeatUnit?: A.ImmutableString }).repeatUnit =
              new A.ImmutableString(value);
          });
        }}
      >
        {Object.entries(units).map(([each, label]) => (
          <option key={each} value={each}>
            {label(every)}
          </option>
        ))}
      </select>
    </div>
  );
}
