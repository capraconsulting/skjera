import type {
  Answers,
  AttendeeRow,
  EventRow,
  Question,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { type FormEvent, useEffect, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { currentSite } from "../../i18n.ts";
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
  // What this member last gave, here: their row has it only once synced.
  const [given, setGiven] = useState<Given | null>(null);
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
    const online = onlineFrom(event, form);
    const signup: Signup = {
      // Emails to them are in it.
      locale: getLocale(),
      ...(dietary === null ? {} : { dietary: String(dietary) }),
      answers: answersFrom(event.questions, form),
      ...(online === undefined ? {} : { online }),
      ...(asGuest
        ? {
            guest: {
              name: String(form.get("firstname") ?? ""),
              email: String(form.get("email") ?? ""),
              phone: String(form.get("telephone") ?? ""),
              company: String(form.get("company") ?? ""),
            },
          }
        : {}),
    };
    if (!asGuest) setGiven(signup);
    settle(
      attendees.collection.insert(
        {
          id: crypto.randomUUID(),
          eventId: event.id,
          signedUpAt: new Date(),
          changedAt: new Date(),
          mine: !asGuest,
          online: online === true,
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
    const online = onlineFrom(event, form);
    const changed: SignupChange = {
      answers: answersFrom(event.questions, form),
      ...(online === undefined ? {} : { online }),
      // Only a guest's form has them; empty clears.
      ...(id === guest?.id
        ? {
            phone: String(form.get("telephone") ?? ""),
            company: String(form.get("company") ?? ""),
          }
        : {}),
    };
    const transaction = attendees.collection.update(
      id,
      { metadata: changed },
      (draft) => {
        draft.changedAt = new Date();
        if (online !== undefined) draft.online = online;
      },
    );
    settle(transaction);
    // Kept open when refused, with what they wrote, to fix it.
    transaction.isPersisted.promise.then(
      () => {
        setEditing(false);
        if (id === mine?.id) setGiven(changed);
      },
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
      ? m.attend_nobody()
      : m.attend_count({ count: signups.length });
  const failure =
    error === null ? null : (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    );

  // Places left; null without a limit. Only those in person take one, when
  // the event is streamed. A limit set below those signed up leaves none.
  const inPerson = event.isStreamed
    ? signups.filter((signup) => !signup.online)
    : signups;
  const left =
    event.maxAttendees === null
      ? null
      : Math.max(0, event.maxAttendees - inPerson.length);
  const full = left === 0;
  // A full streamed event still takes those following online.
  const noMore = full && !event.isStreamed;
  const places = full ? (
    <p className={styles.closes}>
      {event.isStreamed ? m.attend_full_online() : m.attend_full()}
    </p>
  ) : left === null || event.hidePlacesLeft ? null : (
    <p className={styles.closes}>{m.attend_places_left({ count: left })}</p>
  );
  // While full, a member signed up but logged out here can still get to
  // their signup.
  const logInWhenFull = (
    <p className={styles.row}>
      <a href={loginUrl(`/events/${event.id}`)}>
        {m.attend_log_in_signed_up()}
      </a>
    </p>
  );

  if (closed) {
    return (
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        <p className={styles.count}>{count}</p>
        {mine !== undefined || guest !== null ? (
          <p className={styles.status}>
            {mine !== undefined
              ? m.attend_you_attending()
              : m.attend_you_signed_up()}
          </p>
        ) : null}
        <p className={styles.closes}>{m.attend_closed()}</p>
      </section>
    );
  }

  const closes = (
    <p className={styles.closes}>
      {m.attend_closes({ when: formatDateTime(closesAt, event.timeZone) })}
      {asksDietary && event.foodDeadline !== null
        ? ` ${m.attend_dietary_by({ when: formatDateTime(event.foodDeadline, event.timeZone) })}`
        : null}
    </p>
  );
  const asked = (given: Given = {}, signingUp = false) => (
    <>
      {event.isStreamed ? (
        <AttendanceInput
          defaultOnline={given.online}
          // Those in person keep their place when they answer again.
          inPersonDisabled={full && given.online !== false}
        />
      ) : null}
      {/* Asked only when signing up: once given, it belongs to no one. */}
      {signingUp && asksDietary ? <DietaryInput /> : null}
      <QuestionInputs questions={event.questions} given={given.answers} />
    </>
  );
  // There's something to change; a guest always has their phone number and company.
  const changeable = event.questions.length > 0 || event.isStreamed;

  /** Signed up: changing the answers, or cancelling. */
  const signedUp = (
    id: string,
    status: string,
    given: Given,
    asGuest = false,
  ) =>
    editing ? (
      <form
        className={styles.form}
        onSubmit={(submitted) => change(submitted, id)}
        aria-label={m.attend_your_answers()}
      >
        {asGuest ? <GuestContactInputs given={given} /> : null}
        {asked(given)}
        <div className={styles.row}>
          <Button type="submit" variant="primary">
            {m.attend_save_changes()}
          </Button>
          <Button onClick={() => setEditing(false)}>{m.attend_keep()}</Button>
        </div>
      </form>
    ) : (
      <div className={styles.row}>
        <p className={styles.status}>{status}</p>
        {changeable || asGuest ? (
          <Button onClick={() => setEditing(true)}>
            {m.attend_change_answers()}
          </Button>
        ) : null}
        <Button onClick={() => cancel(id)}>
          {mine !== undefined
            ? m.attend_cancel_attendance()
            : m.attend_cancel_signup()}
        </Button>
      </div>
    );

  if (props.signedIn) {
    return (
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        <p className={styles.count}>{count}</p>
        {closes}
        {places}
        {mine !== undefined ? (
          signedUp(mine.id, m.attend_you_attending(), {
            ...(given ?? {
              answers: Object.fromEntries(
                (mine.details?.answers ?? []).map((answer) => [
                  answer.id,
                  answer.value,
                ]),
              ),
            }),
            // The row holds the choice whether or not this browser remembered it.
            online: mine.online,
          })
        ) : noMore ? null : (
          <form
            className={styles.form}
            onSubmit={(submitted) => signUp(submitted, false)}
          >
            {asked({}, true)}
            <div className={styles.row}>
              <Button type="submit" variant="primary">
                {m.attend_attend()}
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
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        <p className={styles.count}>{count}</p>
        {closes}
        {places}
        {noMore ? (
          logInWhenFull
        ) : (
          <p className={styles.row}>
            <a href={loginUrl(`/events/${event.id}`)}>
              {m.attend_log_in_to_attend()}
            </a>
          </p>
        )}
      </section>
    );
  }

  return (
    <section className={styles.box} aria-label={m.attend_region()}>
      <h2 className={styles.heading}>{m.attend_region()}</h2>
      <p className={styles.count}>{count}</p>
      {closes}
      {places}
      {guest === null && noMore ? (
        logInWhenFull
      ) : guest === null ? (
        <form
          className={styles.form}
          onSubmit={(submitted) => signUp(submitted, true)}
        >
          <div className={styles.fields}>
            <Input
              name="firstname"
              autoComplete="name"
              aria-label={m.attend_your_name()}
              placeholder={m.attend_your_name()}
              required
            />
            <Input
              name="email"
              type="email"
              aria-label={m.attend_your_email()}
              placeholder={m.attend_your_email()}
              required
            />
          </div>
          <GuestContactInputs given={{}} />
          {asked({}, true)}
          <div className={styles.row}>
            <Button type="submit" variant="primary">
              {m.attend_sign_up()}
            </Button>
            <span>
              {m.attend_or()}{" "}
              <a href={loginUrl(`/events/${event.id}`)}>{m.attend_log_in()}</a>
            </span>
          </div>
          <p className={styles.privacy}>
            <PrivacyLink />
          </p>
        </form>
      ) : (
        signedUp(
          guest.id,
          m.attend_you_signed_up(),
          {
            ...(guest.given ?? {}),
            online: signups.find((signup) => signup.id === guest.id)?.online,
          },
          true,
        )
      )}
      {failure}
    </section>
  );
}

/** Where guests read how their details are handled. */
function PrivacyLink() {
  const { url } = currentSite().privacy;
  return url === undefined ? (
    <Link to="/privacy">{m.attend_privacy_link()}</Link>
  ) : (
    <a href={url}>{m.attend_privacy_link()}</a>
  );
}

/** What someone told when signing up, to change it. */
type Given = {
  readonly answers?: Answers | undefined;
  /** Follows online rather than in person; unknown for a new signup. */
  readonly online?: boolean | undefined;
  /** A guest's own. */
  readonly phone?: string | undefined;
  readonly company?: string | undefined;
};

/** A guest's phone number and company, both optional; members aren't asked. */
const GuestContactInputs = (props: { readonly given: Given }) => (
  <div className={styles.fields}>
    <Input
      name="telephone"
      type="tel"
      autoComplete="tel"
      defaultValue={props.given.phone}
      aria-label={m.attend_your_phone()}
      placeholder={`${m.attend_your_phone()} ${m.attend_optional()}`}
      maxLength={50}
    />
    <Input
      name="company"
      autoComplete="organization"
      defaultValue={props.given.company}
      aria-label={m.attend_your_company()}
      placeholder={`${m.attend_your_company()} ${m.attend_optional()}`}
      maxLength={100}
    />
  </div>
);

/** Asked, optionally, of everyone signing up when the event serves food. */
const DietaryInput = () => (
  <Input
    name="dietary"
    aria-label={m.attend_dietary()}
    placeholder={`${m.attend_dietary()} ${m.attend_optional()}`}
    maxLength={500}
  />
);

const field = (question: Question) => `question-${question.id}`;

/** What the attendance question was answered: online or not; undefined while not asked. */
const onlineFrom = (event: EventRow, form: FormData) =>
  event.isStreamed ? form.get("attendance") === "online" : undefined;

/**
 * In person or online, picked by everyone signing up to a streamed event:
 * neither is chosen in advance.
 */
function AttendanceInput(props: {
  readonly defaultOnline: boolean | undefined;
  /** No place is left in person. */
  readonly inPersonDisabled: boolean;
}) {
  return (
    <fieldset className={styles.choice}>
      <legend>{m.attend_how()}</legend>
      <label className={styles.check}>
        <input
          type="radio"
          name="attendance"
          value="in-person"
          required
          disabled={props.inPersonDisabled}
          defaultChecked={props.defaultOnline === false}
        />
        {props.inPersonDisabled
          ? m.attend_in_person_full()
          : m.attend_in_person()}
      </label>
      <label className={styles.check}>
        <input
          type="radio"
          name="attendance"
          value="online"
          required
          defaultChecked={props.defaultOnline === true}
        />
        {m.attend_online()}
      </label>
    </fieldset>
  );
}

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
                <span className={styles.optional}> {m.attend_optional()}</span>
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
                <span className={styles.optional}> {m.attend_optional()}</span>
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
