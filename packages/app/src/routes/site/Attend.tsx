import type { EventAttendance, PublishedEvent } from "@skjera/documents/api";
import { useEffect, useState } from "react";
import { Form, useActionData } from "react-router";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { loginUrl } from "../../site/client.ts";
import styles from "./Attend.module.css";
import type { eventAction } from "./EventPage.tsx";

// A guest's cancel token stays in their browser; only they can cancel.
const tokenKey = (id: string) => `skjera-signup-${id}`;
const readToken = (id: string) => {
  try {
    return localStorage.getItem(tokenKey(id));
  } catch {
    return null;
  }
};
const writeToken = (id: string, token: string | null) => {
  try {
    if (token === null) localStorage.removeItem(tokenKey(id));
    else localStorage.setItem(tokenKey(id), token);
  } catch {
    // Private browsing: the signup stands, cancelling needs the organizers.
  }
};

/** Signing up to attend an event, and changing one's mind. */
export function Attend(props: {
  readonly event: PublishedEvent;
  readonly attendance: EventAttendance;
  readonly signedIn: boolean;
}) {
  const { event, attendance } = props;
  const action = useActionData<typeof eventAction>();
  const [guestToken, setGuestToken] = useState(() => readToken(event.id));

  // Remember a new guest signup, or forget a cancelled one.
  useEffect(() => {
    if (action === undefined || !("guestToken" in action)) return;
    writeToken(event.id, action.guestToken);
    setGuestToken(action.guestToken);
  }, [action, event.id]);

  const count =
    attendance.count === 0
      ? "Nobody has signed up yet."
      : `${attendance.count} attending`;
  const error =
    action !== undefined && "error" in action ? (
      <p role="alert" className={styles.error}>
        {action.error}
      </p>
    ) : null;

  if (props.signedIn) {
    return (
      <section className={styles.box} aria-label="Attendance">
        <p className={styles.count}>{count}</p>
        {attendance.attending ? (
          <Form method="post" className={styles.row}>
            <p className={styles.status}>You're attending.</p>
            <Button type="submit" name="intent" value="leave">
              Cancel attendance
            </Button>
          </Form>
        ) : (
          <Form method="post" className={styles.form}>
            {event.askDietary ? <DietaryInput /> : null}
            <div className={styles.row}>
              <Button
                type="submit"
                name="intent"
                value="attend"
                variant="primary"
              >
                Attend
              </Button>
            </div>
          </Form>
        )}
        {error}
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
      {guestToken === null ? (
        <Form method="post" className={styles.form}>
          <input type="hidden" name="intent" value="guest-attend" />
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
        </Form>
      ) : (
        <Form method="post" className={styles.row}>
          <input type="hidden" name="intent" value="guest-leave" />
          <input type="hidden" name="token" value={guestToken} />
          <p className={styles.status}>You're signed up.</p>
          <Button type="submit">Cancel my signup</Button>
        </Form>
      )}
      {error}
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
