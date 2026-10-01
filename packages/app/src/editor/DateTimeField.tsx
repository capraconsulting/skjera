import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { DayPicker } from "@daypicker/react";
import dayPicker from "@daypicker/react/style.module.css";
import type { EventContent } from "@skjera/documents/api";
import { useId, useMemo, useRef, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button.tsx";
import { Field } from "../components/Field.tsx";
import inputStyles from "../components/Input.module.css";
import { Input } from "../components/Input.tsx";
import { placeUnder } from "../components/popover.ts";
import { localTimeZone } from "../time.ts";
import styles from "./DateTimeField.module.css";

// An event's times. Each is a zoned time, "2026-10-15T18:00+02:00[Europe/
// Oslo]", stored as an Automerge ImmutableString: set as a whole, so
// concurrent edits resolve to one of them rather than a mix. They are
// edited as a day and a time on the clock in the event's time zone.

type TimeName = "start" | "end" | "deadline";
type Times = Readonly<Record<TimeName, Temporal.ZonedDateTime | null>>;

const names: ReadonlyArray<TimeName> = ["start", "end", "deadline"];

const write = (time: Temporal.ZonedDateTime) =>
  new A.ImmutableString(time.toString({ smallestUnit: "minute" }));

/** The draft's times, updated as they change. */
const useTimes = (handle: DocHandle<EventContent>): Times => {
  const key = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const doc = handle.doc() as Record<TimeName, unknown>;
      return names.map((name) => String(doc[name] ?? "")).join(" ");
    },
  );
  return useMemo(() => {
    const [start, end, deadline] = key
      .split(" ")
      .map((value) =>
        value === "" ? null : Temporal.ZonedDateTime.from(value),
      ) as [
      Temporal.ZonedDateTime | null,
      ...Array<Temporal.ZonedDateTime | null>,
    ];
    return { start, end: end ?? null, deadline: deadline ?? null };
  }, [key]);
};

/** When the event starts and ends, when sign-up closes, and in what zone. */
export function EventTimes(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { handle } = props;
  const times = useTimes(handle);
  const timeZone =
    times.start?.timeZoneId ??
    times.end?.timeZoneId ??
    times.deadline?.timeZoneId ??
    localTimeZone();

  const set = (name: TimeName, time: Temporal.ZonedDateTime | null) =>
    handle.change((doc) => {
      const draft = doc as Record<TimeName, unknown>;
      draft[name] = time === null ? null : write(time);
      if (name !== "start" || time === null) return;
      // Moving the start moves the end with it, as in calendars; a first
      // start without an end gets a two-hour event.
      if (times.start !== null && times.end !== null) {
        draft.end = write(time.add(times.start.until(times.end)));
      } else if (times.end === null) {
        draft.end = write(time.add({ hours: 2 }));
      }
    });

  /** Moves the times to another zone, keeping them on the clock. */
  const setZone = (zone: string) =>
    handle.change((doc) => {
      const draft = doc as Record<TimeName, unknown>;
      for (const name of names) {
        const time = times[name];
        if (time !== null) {
          draft[name] = write(time.toPlainDateTime().toZonedDateTime(zone));
        }
      }
    });

  const startDate = times.start?.toPlainDate();
  return (
    <>
      <Field label="Starts">
        <DateTimeField
          label="Start"
          value={times.start}
          timeZone={timeZone}
          defaultTime={Temporal.PlainTime.from("17:00")}
          onChange={(time) => set("start", time)}
        />
      </Field>
      <Field label="Ends">
        <DateTimeField
          label="End"
          value={times.end}
          timeZone={timeZone}
          defaultTime={
            times.start?.add({ hours: 2 }).toPlainTime() ??
            Temporal.PlainTime.from("19:00")
          }
          {...(startDate === undefined ? {} : { defaultDate: startDate })}
          onChange={(time) => set("end", time)}
        />
      </Field>
      <Field label="Sign-up deadline">
        <DateTimeField
          label="Deadline"
          value={times.deadline}
          timeZone={timeZone}
          defaultTime={Temporal.PlainTime.from("12:00")}
          {...(startDate === undefined
            ? {}
            : { defaultDate: startDate.subtract({ days: 1 }) })}
          onChange={(time) => set("deadline", time)}
          clearable
        />
        <p className={styles.hint}>
          Signing up and cancelling close then. Without a deadline, they close
          when the event starts.
        </p>
      </Field>
      <Field label="Time zone">
        <TimeZoneSelect value={timeZone} onChange={setZone} />
      </Field>
    </>
  );
}

const today = () => Temporal.Now.plainDateISO();

/** A day and a time on the clock, in `timeZone`. */
function DateTimeField(props: {
  readonly label: string;
  readonly value: Temporal.ZonedDateTime | null;
  readonly timeZone: string;
  /** The time a newly picked day gets. */
  readonly defaultTime: Temporal.PlainTime;
  /** The day a time typed first goes on; today if not given. */
  readonly defaultDate?: Temporal.PlainDate;
  readonly clearable?: boolean;
  readonly onChange: (value: Temporal.ZonedDateTime | null) => void;
}) {
  const { value } = props;
  const popoverId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const date = value?.toPlainDate() ?? null;
  // DayPicker works with local Dates; this one shows the day as it is.
  const shown =
    date === null ? undefined : new Date(date.year, date.month - 1, date.day);

  const change = (day: Temporal.PlainDate, time: Temporal.PlainTime) =>
    props.onChange(
      day.toZonedDateTime({ timeZone: props.timeZone, plainTime: time }),
    );

  return (
    <div className={styles.field}>
      <button
        ref={trigger}
        type="button"
        popoverTarget={popoverId}
        className={styles.trigger}
        aria-label={`${props.label} date`}
      >
        {shown === undefined ? (
          <span className={styles.placeholder}>Pick a date</span>
        ) : (
          shown.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        )}
        <CalendarIcon />
      </button>
      <Input
        type="time"
        aria-label={`${props.label} time`}
        className={styles.time}
        value={value?.toPlainTime().toString({ smallestUnit: "minute" }) ?? ""}
        onChange={(event) => {
          // Empty while the time is being typed, or cleared: keep the last.
          if (event.currentTarget.value === "") return;
          change(
            date ?? props.defaultDate ?? today(),
            Temporal.PlainTime.from(event.currentTarget.value),
          );
        }}
      />
      {props.clearable && value !== null ? (
        <Button
          variant="ghost"
          onClick={() => props.onChange(null)}
          aria-label={`Clear ${props.label.toLowerCase()}`}
        >
          Clear
        </Button>
      ) : null}
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
          selected={shown}
          {...(shown === undefined ? {} : { defaultMonth: shown })}
          onSelect={(picked) => {
            if (picked !== undefined) {
              change(
                Temporal.PlainDate.from({
                  year: picked.getFullYear(),
                  month: picked.getMonth() + 1,
                  day: picked.getDate(),
                }),
                value?.toPlainTime() ?? props.defaultTime,
              );
            }
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

/** Every time zone the browser knows, by its IANA name. */
function TimeZoneSelect(props: {
  readonly value: string;
  readonly onChange: (zone: string) => void;
}) {
  const zones = useMemo(() => {
    const known = Intl.supportedValuesOf("timeZone");
    return known.includes(props.value) ? known : [props.value, ...known];
  }, [props.value]);
  return (
    <select
      aria-label="Time zone"
      className={`${inputStyles.input} ${styles.zone}`}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll("_", " ")}
        </option>
      ))}
    </select>
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
