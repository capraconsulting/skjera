import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import { DayPicker } from "@daypicker/react";
import { enUS } from "@daypicker/react/locale/en-US";
import { nb } from "@daypicker/react/locale/nb";
import { nn } from "@daypicker/react/locale/nn";
import dayPicker from "@daypicker/react/style.module.css";
import { type EventContent, signupClosesAt } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { useId, useMemo, useRef, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { Button } from "../components/Button.tsx";
import { Field } from "../components/Field.tsx";
import { Input, Select } from "../components/Input.tsx";
import { placeUnder } from "../components/popover.ts";
import { localTimeZone } from "../time.ts";
import styles from "./DateTimeField.module.css";

/** The calendar's month and day names, in the interface's language. */
const dayPickerLocales = { en: enUS, nb, nn };

// An event's times. Each is a zoned time, "2026-10-15T18:00+02:00[Europe/
// Oslo]", stored as an Automerge ImmutableString: set as a whole, so
// concurrent edits resolve to one of them rather than a mix. They are
// edited as a day and a time on the clock in the event's time zone.

type TimeName = "start" | "end" | "deadline" | "foodDeadline";
type Times = Readonly<Record<TimeName, Temporal.ZonedDateTime | null>>;

const names: ReadonlyArray<TimeName> = [
  "start",
  "end",
  "deadline",
  "foodDeadline",
];

const write = (time: Temporal.ZonedDateTime) =>
  new A.ImmutableString(time.toString({ smallestUnit: "minute" }));

/**
 * The draft's times, updated as they change, the zone they are in, and
 * setting them.
 */
const useEventTimes = (handle: DocHandle<EventContent>) => {
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
  const times = useMemo(() => {
    const values = key.split(" ");
    return Object.fromEntries(
      names.map((name, index) => {
        const value = values[index] ?? "";
        return [name, value === "" ? null : Temporal.ZonedDateTime.from(value)];
      }),
    ) as Times;
  }, [key]);
  const timeZone =
    names.map((name) => times[name]?.timeZoneId).find(Boolean) ??
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

  return { times, timeZone, set, setZone };
};

/** When the event starts and ends, when sign-up closes, and in what zone. */
export function EventTimes(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { times, timeZone, set, setZone } = useEventTimes(props.handle);
  const startDate = times.start?.toPlainDate();
  return (
    <>
      <Field label={m.editor_starts()}>
        <DateTimeField
          labels={{ date: m.editor_start_date(), time: m.editor_start_time() }}
          value={times.start}
          timeZone={timeZone}
          defaultTime={Temporal.PlainTime.from("17:00")}
          onChange={(time) => set("start", time)}
        />
      </Field>
      <Field label={m.editor_ends()}>
        <DateTimeField
          labels={{ date: m.editor_end_date(), time: m.editor_end_time() }}
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
      <Field label={m.editor_deadline()}>
        <DateTimeField
          labels={{
            date: m.editor_deadline_date(),
            time: m.editor_deadline_time(),
            clear: m.editor_deadline_clear(),
          }}
          value={times.deadline}
          timeZone={timeZone}
          defaultTime={Temporal.PlainTime.from("12:00")}
          {...(startDate === undefined
            ? {}
            : { defaultDate: startDate.subtract({ days: 1 }) })}
          onChange={(time) => set("deadline", time)}
          clearable
        />
        <p className={styles.hint}>{m.editor_deadline_hint()}</p>
      </Field>
      <Field label={m.editor_time_zone()}>
        <TimeZoneSelect value={timeZone} onChange={setZone} />
      </Field>
    </>
  );
}

/** Until when people say what they can't eat, in the event's zone. */
export function FoodDeadline(props: {
  readonly handle: DocHandle<EventContent>;
}) {
  const { times, timeZone, set } = useEventTimes(props.handle);
  const closes = signupClosesAt(times.deadline, times.start)?.toPlainDate();
  return (
    <>
      <DateTimeField
        labels={{
          date: m.editor_food_deadline_date(),
          time: m.editor_food_deadline_time(),
          clear: m.editor_food_deadline_clear(),
        }}
        value={times.foodDeadline}
        timeZone={timeZone}
        defaultTime={Temporal.PlainTime.from("12:00")}
        {...(closes === undefined ? {} : { defaultDate: closes })}
        onChange={(time) => set("foodDeadline", time)}
        clearable
      />
      <p className={styles.hint}>{m.editor_food_deadline_hint()}</p>
    </>
  );
}

const today = () => Temporal.Now.plainDateISO();

/** A day and a time on the clock, in `timeZone`. */
function DateTimeField(props: {
  /** Its parts' names, e.g. "Start date", "Start time". */
  readonly labels: {
    readonly date: string;
    readonly time: string;
    readonly clear?: string;
  };
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
        aria-label={props.labels.date}
      >
        {shown === undefined ? (
          <span className={styles.placeholder}>{m.editor_pick_date()}</span>
        ) : (
          shown.toLocaleDateString(getLocale(), {
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
        aria-label={props.labels.time}
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
          aria-label={props.labels.clear}
        >
          {m.editor_clear()}
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
          locale={dayPickerLocales[getLocale()]}
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
    <Select
      aria-label={m.editor_time_zone()}
      className={styles.zone}
      value={props.value}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    >
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll("_", " ")}
        </option>
      ))}
    </Select>
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
