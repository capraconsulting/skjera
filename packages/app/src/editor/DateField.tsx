import * as A from "@automerge/automerge/slim";
import { DayPicker } from "@daypicker/react";
import dayPicker from "@daypicker/react/style.module.css";
import type { EventContent } from "@skjera/documents/api";
import { useId, useRef, useSyncExternalStore } from "react";
import { Button } from "../components/Button.tsx";
import { placeUnder } from "../components/popover.ts";
import { formatLongDate, fromIsoDate, toIsoDate } from "../time.ts";
import styles from "./DateField.module.css";
import type { LocalDocHandle } from "./LocalDocHandle.ts";

/**
 * A collaborative date field. The date is an Automerge ImmutableString, set
 * as a whole, so concurrent picks resolve to one of them rather than a mix.
 */
export function DateField(props: {
  readonly handle: LocalDocHandle<EventContent>;
  readonly label: string;
}) {
  const { handle } = props;
  const date = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const value = handle.doc().date;
      return value === null || value === undefined ? null : String(value);
    },
  );
  const popoverId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  const set = (value: string | null) =>
    handle.change((doc) => {
      (doc as { date: unknown }).date =
        value === null ? null : new A.ImmutableString(value);
    });

  return (
    <div className={styles.field}>
      <button
        ref={trigger}
        type="button"
        popoverTarget={popoverId}
        className={styles.trigger}
        aria-label={props.label}
      >
        {date === null ? (
          <span className={styles.placeholder}>Pick a date</span>
        ) : (
          formatLongDate(date)
        )}
        <CalendarIcon />
      </button>
      {date === null ? null : (
        <Button
          variant="ghost"
          onClick={() => set(null)}
          aria-label="Clear date"
        >
          Clear
        </Button>
      )}
      <div
        id={popoverId}
        popover="auto"
        className={styles.popover}
        onToggle={(event) => {
          if (event.newState === "open") {
            placeUnder(event.currentTarget, trigger.current);
          }
        }}
      >
        <DayPicker
          mode="single"
          selected={date === null ? undefined : fromIsoDate(date)}
          {...(date === null ? {} : { defaultMonth: fromIsoDate(date) })}
          onSelect={(picked) => {
            set(picked === undefined ? null : toIsoDate(picked));
            document.getElementById(popoverId)?.hidePopover();
          }}
          weekStartsOn={1}
          classNames={{
            ...dayPicker,
            root: `${dayPicker.root} ${styles.calendar}`,
          }}
        />
      </div>
    </div>
  );
}

const CalendarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
    <rect
      x="3"
      y="5"
      width="18"
      height="16"
      rx="2"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2" />
  </svg>
);
