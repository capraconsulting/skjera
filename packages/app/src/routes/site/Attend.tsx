import type {
  Answers,
  AttendeeRow,
  EventRow,
  Question,
} from "@skjera/documents/api";
import { type FormEvent, useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { loginUrl } from "../../site/client.ts";
import { guestSignup, rememberGuestSignup } from "../../site/guestSignups.ts";
import {
  attendees,
  type Signup,
  type SignupChange,
} from "../../sync/tables.ts";
import { formatDateTime } from "../../time.ts";
import styles from "./Attend.module.css";

/** Whether `at` has passed, turning true when it does. */
const useHasPassed = (at: Date) => {
  const time = at.getTime();
  const [passed, setPassed] = useState(() => time <= Date.now());
  useEffect(() => {
    const left = time - Date.now();
    setPassed(left <= 0);
    if (left <= 0) return;
    // setTimeout takes at most about 24 days.
    const timer = setTimeout(
      () => setPassed(time <= Date.now()),
      Math.min(left, 2 ** 31 - 1),
    );
    return () => clearTimeout(timer);
  }, [time]);
  return passed;
};

/**
 * Signing up to attend an event, and changing one's mind, until sign-up
 * closes. Changes show at once; a refused one is undone, and says why.
 */
export function Attend(props: {
  readonly event: EventRow;
  /** Everyone signed up for the event. */
  readonly signups: ReadonlyArray<AttendeeRow>;
  readonly signedIn: boolean;
}) {
  const { event, signups } = props;
  const [error, setError] = useState<string | null>(null);
  // This browser's guest signup, if it made one and it's still there: the
  // organizers may have taken it off.
  const [remembered, setGuest] = useState(() => guestSignup(event.id));
  const guest =
    remembered !== null && signups.some((signup) => signup.id === remembered.id)
      ? remembered
      : null;
  // Changing one's answers.
  const [editing, setEditing] = useState(false);
  const mine = signups.find((signup) => signup.mine);
  const closesAt = event.signupDeadline ?? event.startsAt;
  const closed = useHasPassed(closesAt);
  // After the food deadline, people can still come; they're not asked.
  const foodClosed = useHasPassed(event.foodDeadline ?? closesAt);
  const asksDietary = event.askDietary && !foodClosed;

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
      answers: answersFrom(event.questions, form),
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
          changedAt: new Date(),
          mine: !asGuest,
          details: null,
        },
        { metadata: signup },
      ),
    );
  };

  /** Saves changed answers; the row's own fields don't hold them. */
  const change = (submitted: FormEvent<HTMLFormElement>, id: string) => {
    submitted.preventDefault();
    const form = new FormData(submitted.currentTarget);
    const dietary = form.get("dietary");
    const changed: SignupChange = {
      ...(dietary === null ? {} : { dietary: String(dietary) }),
      answers: answersFrom(event.questions, form),
    };
    const transaction = attendees.collection.update(
      id,
      { metadata: changed },
      (draft) => {
        draft.changedAt = new Date();
      },
    );
    settle(transaction);
    // Kept open when refused, with what they wrote, to fix it.
    transaction.isPersisted.promise.then(
      () => setEditing(false),
      () => {},
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

  if (closed) {
    return (
      <section className={styles.box} aria-label="Attendance">
        <p className={styles.count}>{count}</p>
        {mine !== undefined || guest !== null ? (
          <p className={styles.status}>
            {mine !== undefined ? "You're attending." : "You're signed up."}
          </p>
        ) : null}
        <p className={styles.closes}>Sign-up has closed.</p>
      </section>
    );
  }

  const closes = (
    <p className={styles.closes}>
      Sign-up closes {formatDateTime(closesAt, event.timeZone)}.
      {asksDietary && event.foodDeadline !== null
        ? ` Dietary preferences by ${formatDateTime(event.foodDeadline, event.timeZone)}.`
        : null}
    </p>
  );
  const asked = (given: Given = {}) => (
    <>
      {asksDietary ? <DietaryInput defaultValue={given.dietary} /> : null}
      <QuestionInputs questions={event.questions} given={given.answers} />
    </>
  );
  // There's something to change.
  const changeable = asksDietary || event.questions.length > 0;

  /** Signed up: changing the answers, or cancelling. */
  const signedUp = (id: string, status: string, given: Given) =>
    editing ? (
      <form
        className={styles.form}
        onSubmit={(submitted) => change(submitted, id)}
        aria-label="Your answers"
      >
        {asked(given)}
        <div className={styles.row}>
          <Button type="submit" variant="primary">
            Save changes
          </Button>
          <Button onClick={() => setEditing(false)}>Keep as is</Button>
        </div>
      </form>
    ) : (
      <div className={styles.row}>
        <p className={styles.status}>{status}</p>
        {changeable ? (
          <Button onClick={() => setEditing(true)}>Change answers</Button>
        ) : null}
        <Button onClick={() => cancel(id)}>
          {mine !== undefined ? "Cancel attendance" : "Cancel my signup"}
        </Button>
      </div>
    );

  if (props.signedIn) {
    return (
      <section className={styles.box} aria-label="Attendance">
        <p className={styles.count}>{count}</p>
        {closes}
        {mine !== undefined ? (
          signedUp(mine.id, "You're attending.", {
            ...(mine.details?.dietary == null
              ? {}
              : { dietary: mine.details.dietary }),
            answers: Object.fromEntries(
              (mine.details?.answers ?? []).map((answer) => [
                answer.id,
                answer.value,
              ]),
            ),
          })
        ) : (
          <form
            className={styles.form}
            onSubmit={(submitted) => signUp(submitted, false)}
          >
            {asked()}
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
        {closes}
        <p className={styles.row}>
          <a href={loginUrl(`/events/${event.id}`)}>Log in to attend</a>
        </p>
      </section>
    );
  }

  return (
    <section className={styles.box} aria-label="Attendance">
      <p className={styles.count}>{count}</p>
      {closes}
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
          {asked()}
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
        signedUp(guest.id, "You're signed up.", guest.given ?? {})
      )}
      {failure}
    </section>
  );
}

/** What someone told when signing up, to change it. */
type Given = {
  readonly dietary?: string | undefined;
  readonly answers?: Answers | undefined;
};

/** Asked of everyone signing up, when the event wants to know. */
const DietaryInput = (props: {
  readonly defaultValue?: string | undefined;
}) => (
  <Input
    name="dietary"
    defaultValue={props.defaultValue}
    aria-label="Dietary preferences"
    placeholder={'Dietary preferences (write "none" if you have none)'}
    required
    maxLength={500}
  />
);

const field = (question: Question) => `question-${question.id}`;

/** The answers in a signup form, by question id. */
const answersFrom = (
  questions: ReadonlyArray<Question>,
  form: FormData,
): Answers => {
  const answers: Record<string, string | boolean> = {};
  for (const question of questions) {
    const value = form.get(field(question));
    if (question.type === "checkbox") answers[question.id] = value !== null;
    else if (value !== null) answers[question.id] = String(value);
  }
  return answers;
};

/** The event's questions, as form fields. */
function QuestionInputs(props: {
  readonly questions: ReadonlyArray<Question>;
  /** Answers given before, to start from. */
  readonly given?: Answers | undefined;
}) {
  const given = props.given ?? {};
  return props.questions.map((question) => {
    switch (question.type) {
      case "text":
        return (
          <div key={question.id} className={styles.question}>
            <label htmlFor={field(question)}>
              {question.text}
              {question.required ? null : (
                <span className={styles.optional}> (optional)</span>
              )}
            </label>
            <Input
              id={field(question)}
              name={field(question)}
              defaultValue={
                typeof given[question.id] === "string"
                  ? String(given[question.id])
                  : undefined
              }
              required={question.required}
              maxLength={1000}
            />
          </div>
        );
      case "checkbox":
        return (
          <label key={question.id} className={styles.check}>
            <input
              type="checkbox"
              name={field(question)}
              required={question.required}
              defaultChecked={given[question.id] === true}
            />
            {question.text}
          </label>
        );
      case "choice":
        return (
          <fieldset key={question.id} className={styles.choice}>
            <legend>
              {question.text}
              {question.required ? null : (
                <span className={styles.optional}> (optional)</span>
              )}
            </legend>
            {question.options.map((option) => (
              <label key={option.id} className={styles.check}>
                <input
                  type="radio"
                  name={field(question)}
                  value={option.id}
                  required={question.required}
                  defaultChecked={given[question.id] === option.id}
                />
                {option.text}
              </label>
            ))}
          </fieldset>
        );
      default:
        return null;
    }
  });
}
