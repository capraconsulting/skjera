import type { AttendeeRow, EventRow } from "@skjera/documents/api";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { loginUrl } from "../../site/client.ts";
import { guestSignup, rememberGuestSignup } from "../../site/guestSignups.ts";
import { attendees, type Signup } from "../../sync/tables.ts";
import styles from "./Attend.module.css";

/**
 * Signing up to attend an event, and changing one's mind. Changes show at
 * once; a refused one is undone, and says why.
 */
export function Attend(props: {
  readonly event: EventRow;
  /** Everyone signed up for the event. */
  readonly signups: ReadonlyArray<AttendeeRow>;
  readonly signedIn: boolean;
}) {
  const { event, signups } = props;
  const [error, setError] = useState<string | null>(null);
  // This browser's guest signup, if it made one.
  const [guest, setGuest] = useState(() => guestSignup(event.id));
  const mine = signups.find((signup) => signup.mine);

  const settle = (change: {
    readonly isPersisted: { promise: Promise<unknown> };
  }) => {
    setError(null);
    change.isPersisted.promise.then(
      () => setGuest(guestSignup(event.id)),
      (failure: Error) => setError(failure.message),
    );
  };

  const signUp = (submitted: FormEvent<HTMLFormElement>, asGuest: boolean) => {
    submitted.preventDefault();
    const form = new FormData(submitted.currentTarget);
    const dietary = form.get("dietary");
    const signup: Signup = {
      ...(dietary === null ? {} : { dietary: String(dietary) }),
      ...(asGuest
        ? {
            guest: {
              name: String(form.get("name") ?? ""),
              email: String(form.get("email") ?? ""),
            },
          }
        : {}),
    };
    settle(
      attendees.collection.insert(
        {
          id: crypto.randomUUID(),
          eventId: event.id,
          signedUpAt: new Date(),
          mine: !asGuest,
          details: null,
        },
        { metadata: signup },
      ),
    );
  };

  const cancel = (id: string) => {
    if (attendees.collection.has(id)) {
      settle(attendees.collection.delete(id));
    } else {
      // Gone already, e.g. removed by the organizers.
      rememberGuestSignup(event.id, null);
      setGuest(null);
    }
  };

  const count =
    signups.length === 0
      ? "Nobody has signed up yet."
      : `${signups.length} attending`;
  const failure =
    error === null ? null : (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    );

  if (props.signedIn) {
    return (
      <section className={styles.box} aria-label="Attendance">
        <p className={styles.count}>{count}</p>
        {mine !== undefined ? (
          <div className={styles.row}>
            <p className={styles.status}>You're attending.</p>
            <Button onClick={() => cancel(mine.id)}>Cancel attendance</Button>
          </div>
        ) : (
          <form
            className={styles.form}
            onSubmit={(submitted) => signUp(submitted, false)}
          >
            {event.askDietary ? <DietaryInput /> : null}
            <div className={styles.row}>
              <Button type="submit" variant="primary">
                Attend
              </Button>
            </div>
          </form>
        )}
        {failure}
      </section>
    );
  }

  if (!event.allowGuests) {
    return (
      <section className={styles.box} aria-label="Attendance">
        <p className={styles.count}>{count}</p>
        <p className={styles.row}>
          <a href={loginUrl(`/events/${event.id}`)}>Log in to attend</a>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.box} aria-label="Attendance">
      <p className={styles.count}>{count}</p>
      {guest === null ? (
        <form
          className={styles.form}
          onSubmit={(submitted) => signUp(submitted, true)}
        >
          <div className={styles.fields}>
            <Input
              name="name"
              aria-label="Your name"
              placeholder="Your name"
              required
            />
            <Input
              name="email"
              type="email"
              aria-label="Your email"
              placeholder="Your email"
              required
            />
          </div>
          {event.askDietary ? <DietaryInput /> : null}
          <div className={styles.row}>
            <Button type="submit" variant="primary">
              Sign up
            </Button>
            <span>
              or <a href={loginUrl(`/events/${event.id}`)}>log in</a>
            </span>
          </div>
        </form>
      ) : (
        <div className={styles.row}>
          <p className={styles.status}>You're signed up.</p>
          <Button onClick={() => cancel(guest.id)}>Cancel my signup</Button>
        </div>
      )}
      {failure}
    </section>
  );
}

/** Asked of everyone signing up, when the event wants to know. */
const DietaryInput = () => (
  <Input
    name="dietary"
    aria-label="Dietary preferences"
    placeholder={'Dietary preferences (write "none" if you have none)'}
    required
    maxLength={500}
  />
);
