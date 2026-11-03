import {
  type Answers,
  type AttendeeRow,
  type DocumentId,
  describe,
  type EventRow,
  type GuestProblem,
  guestProblems,
  type Question,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import {
  type FormEvent,
  type InputHTMLAttributes,
  useEffect,
  useId,
  useState,
} from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { currentSite } from "../../i18n.ts";
import { sayWhy } from "../../problems.ts";
import { loginUrl } from "../../site/client.ts";
import {
  type GuestSignup,
  guestSignup,
  rememberGuestSignup,
  requestCancelByEmail,
  storedGuestSignup,
} from "../../site/guestSignups.ts";
import { placesLeft } from "../../site/signupCount.ts";
import {
  chosenOption,
  fieldOf,
  type GuestField,
} from "../../site/signupForm.ts";
import {
  attendees,
  type GuestCancel,
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
  /** The email of the member logged in, where the login gave one. */
  readonly email: string | undefined;
  /** The guest's link, just opened, led to no signup. */
  readonly linkGone: boolean;
}) {
  const { event, signups } = props;
  const [error, setError] = useState<string | null>(null);
  // Why a guest input was refused, shown by the input.
  const [messages, setMessages] = useState<FieldMessages>({});
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
  // What the server has for this guest, read each time the form opens: a
  // change made from another browser is there too.
  const [stored, setStored] = useState<Given | null>(null);
  // Said until they sign up.
  const [signedUpSince, setSignedUpSince] = useState(false);
  // What was last done here, this page view: signed up (to where the
  // confirmation goes) or cancelled. A refusal clears it.
  const [last, setLast] = useState<
    | { readonly kind: "signedUp"; readonly email: string }
    | { readonly kind: "cancelled" }
    | null
  >(null);
  // What this member last gave, here: their row has it only once synced.
  const [given, setGiven] = useState<Given | null>(null);
  const closesAt = event.signupDeadline ?? event.startsAt;
  const closed = useHasPassed(closesAt);
  // After the food deadline, people can still come; they're not asked.
  const foodClosed = useHasPassed(event.foodDeadline ?? closesAt);
  const asksDietary = event.askDietary && !foodClosed;
  // The food deadline, said once it has passed too.
  const food =
    event.askDietary && event.foodDeadline !== null
      ? [
          m.attend_dietary_by({
            when: formatDateTime(event.foodDeadline, event.timeZone),
          }),
          ...(foodClosed ? [m.attend_deadline_passed()] : []),
        ].join(" ")
      : null;

  /** Shows what is wrong with the guest's inputs, each by its own. */
  const refuse = (problems: ReadonlyArray<GuestProblem>) => {
    setError(null);
    setMessages(messagesFor(problems));
  };

  const settle = (
    change: { readonly isPersisted: { promise: Promise<unknown> } },
    onRefused?: () => void,
  ) => {
    setError(null);
    setMessages({});
    change.isPersisted.promise.then(
      () => setGuest(guestSignup(event.id)),
      (failure: Error & { readonly problem?: unknown }) => {
        onRefused?.();
        // A refusal about one of the guest's inputs shows by it.
        const field = fieldOf(failure.problem);
        if (field === undefined) setError(failure.message);
        else setMessages({ [field]: failure.message });
      },
    );
  };

  const signUp = (submitted: FormEvent<HTMLFormElement>, asGuest: boolean) => {
    submitted.preventDefault();
    const form = new FormData(submitted.currentTarget);
    if (asGuest) {
      const problems = guestProblems({
        name: String(form.get("firstname") ?? ""),
        phone: String(form.get("telephone") ?? ""),
        company: String(form.get("company") ?? ""),
      });
      if (problems.length > 0) return refuse(problems);
    }
    setSignedUpSince(true);
    const confirmedTo = asGuest
      ? String(form.get("email") ?? "").trim()
      : props.email;
    setLast(
      confirmedTo === undefined || confirmedTo === ""
        ? null
        : { kind: "signedUp", email: confirmedTo },
    );
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
            honeypot: String(form.get("subject") ?? ""),
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
      () => setLast(null),
    );
  };

  /** Saves changed answers; the row's own fields don't hold them. */
  const change = (submitted: FormEvent<HTMLFormElement>, id: string) => {
    submitted.preventDefault();
    const form = new FormData(submitted.currentTarget);
    if (id === guest?.id) {
      const problems = guestProblems({
        phone: String(form.get("telephone") ?? ""),
        company: String(form.get("company") ?? ""),
      });
      if (problems.length > 0) return refuse(problems);
    }
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

  /** Opens a guest's form from what the server has stored for them. */
  const changeAsGuest = (signup: GuestSignup) => {
    setError(null);
    setMessages({});
    storedGuestSignup(event.id, signup.cancelToken).then(
      (found) => {
        if (found === null) {
          // Cancelled or taken off elsewhere: forgotten here too.
          rememberGuestSignup(event.id, null);
          setGuest(null);
          return;
        }
        setStored({
          answers: found.answers,
          phone: found.phone ?? undefined,
          company: found.company ?? undefined,
        });
        setEditing(true);
      },
      () => setError(m.common_something_wrong()),
    );
  };

  /** `honeypot` is what a guest's cancel form's hidden field held. */
  const cancel = (id: string, honeypot?: string) => {
    setLast({ kind: "cancelled" });
    if (attendees.collection.has(id)) {
      settle(
        attendees.collection.delete(
          id,
          honeypot === undefined
            ? {}
            : { metadata: { honeypot } satisfies GuestCancel },
        ),
        () => setLast(null),
      );
    } else {
      // Gone already, e.g. removed by the organizers.
      rememberGuestSignup(event.id, null);
      setGuest(null);
    }
  };

  // Only those logged in are told how many are signed up.
  const count = !props.signedIn ? null : (
    <p className={styles.count}>
      {signups.length === 0
        ? m.attend_nobody()
        : m.attend_count({ count: signups.length })}
    </p>
  );
  // The link just opened led to no signup, and none is shown.
  const gone =
    props.linkGone && !signedUpSince && guest === null && mine === undefined ? (
      <p className={styles.status}>{m.attend_link_gone()}</p>
    ) : null;
  // Cancelled here: whether the confirmation email goes.
  const cancelled =
    last?.kind === "cancelled" && mine === undefined && guest === null ? (
      <p role="status" className={styles.status}>
        {currentSite().sendsEmail === false
          ? m.cancel_done_no_email()
          : m.cancel_done()}
      </p>
    ) : null;
  // Signed up here: where the confirmation goes.
  const signedUpNow =
    last?.kind === "signedUp"
      ? m.attend_signed_up_now({ email: last.email })
      : null;
  const failure =
    error === null ? null : (
      <p role="alert" className={styles.error}>
        {error}
      </p>
    );

  const left = placesLeft(event, signups);
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

  // Members only, to someone not logged in: they log in to sign up. They
  // get no signups of it, so there is no count to show.
  if (!props.signedIn && !event.isPublic) {
    return (
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        <p className={styles.status}>{m.attend_log_in_members_only()}</p>
        <div className={styles.row}>
          <Button
            variant="primary"
            onClick={() =>
              window.location.assign(loginUrl(`/events/${event.id}`))
            }
          >
            {m.common_log_in()}
          </Button>
        </div>
      </section>
    );
  }

  if (closed) {
    return (
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        {count}
        {gone}
        {cancelled}
        {mine !== undefined || guest !== null ? (
          <p className={styles.status}>
            {mine !== undefined
              ? m.attend_you_attending()
              : m.attend_you_signed_up()}
          </p>
        ) : null}
        <p className={styles.closes}>{m.attend_closed()}</p>
        {food === null ? null : <p className={styles.closes}>{food}</p>}
      </section>
    );
  }

  const closes = (
    <p className={styles.closes}>
      {m.attend_closes({ when: formatDateTime(closesAt, event.timeZone) })}
      {food === null ? null : ` ${food}`}
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
        {asGuest ? (
          <GuestContactInputs given={given} messages={messages} />
        ) : null}
        {asked(given)}
        <div className={styles.row}>
          <Button type="submit" variant="primary">
            {m.attend_save_changes()}
          </Button>
          <Button onClick={() => setEditing(false)}>{m.attend_keep()}</Button>
        </div>
      </form>
    ) : asGuest ? (
      // A form, so the cancel carries the hidden field for bots.
      <form
        className={styles.row}
        onSubmit={(submitted) => {
          submitted.preventDefault();
          const form = new FormData(submitted.currentTarget);
          cancel(id, String(form.get("subject") ?? ""));
        }}
      >
        <p className={styles.status}>{status}</p>
        <Button
          onClick={() =>
            guest !== null ? changeAsGuest(guest) : setEditing(true)
          }
        >
          {m.attend_change_answers()}
        </Button>
        <HoneypotInput />
        <Button type="submit">{m.attend_cancel_signup()}</Button>
      </form>
    ) : (
      <div className={styles.row}>
        <p className={styles.status}>{status}</p>
        {changeable ? (
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
        {count}
        {gone}
        {cancelled}
        {closes}
        {places}
        {mine !== undefined ? (
          signedUp(mine.id, signedUpNow ?? m.attend_you_attending(), {
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
        {count}
        {gone}
        {cancelled}
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
    <>
      <section className={styles.box} aria-label={m.attend_region()}>
        <h2 className={styles.heading}>{m.attend_region()}</h2>
        {count}
        {gone}
        {cancelled}
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
              <GuestInput
                name="firstname"
                messages={messages}
                autoComplete="name"
                aria-label={m.attend_your_name()}
                placeholder={m.attend_your_name()}
                required
              />
              <GuestInput
                name="email"
                messages={messages}
                type="email"
                aria-label={m.attend_your_email()}
                placeholder={m.attend_your_email()}
                required
              />
              <HoneypotInput />
            </div>
            <GuestContactInputs given={{}} messages={messages} />
            {asked({}, true)}
            <div className={styles.row}>
              <Button type="submit" variant="primary">
                {m.attend_sign_up()}
              </Button>
              <span>
                {m.attend_or()}{" "}
                <a href={loginUrl(`/events/${event.id}`)}>
                  {m.attend_log_in()}
                </a>
              </span>
            </div>
            <p className={styles.privacy}>
              <PrivacyLink />
            </p>
          </form>
        ) : (
          signedUp(
            guest.id,
            signedUpNow ?? m.attend_you_signed_up(),
            {
              ...(stored ?? {}),
              online: signups.find((signup) => signup.id === guest.id)?.online,
            },
            true,
          )
        )}
        {failure}
      </section>
      {guest === null ? <CancelByEmail eventId={event.id} /> : null}
    </>
  );
}

/**
 * Cancelling without the signup's own link, for a guest who has lost the
 * email: a link that cancels is sent to the address they signed up with.
 * It has a region of its own, apart from the sign-up box.
 */
function CancelByEmail(props: { readonly eventId: DocumentId }) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = (submitted: FormEvent<HTMLFormElement>) => {
    submitted.preventDefault();
    const form = new FormData(submitted.currentTarget);
    const email = String(form.get("cancelEmail") ?? "").trim();
    setBusy(true);
    requestCancelByEmail(
      props.eventId,
      email,
      String(form.get("subject") ?? ""),
    ).then(
      (refused) => {
        setBusy(false);
        setSent(refused === null ? email : null);
        setError(
          refused === null
            ? null
            : sayWhy(refused.why, m.common_something_wrong()),
        );
      },
      () => {
        setBusy(false);
        setSent(null);
        setError(m.common_something_wrong());
      },
    );
  };

  return (
    <section
      className={`${styles.box} ${styles.cancelByEmail}`}
      aria-label={m.attend_cancel_by_email()}
    >
      <h2 className={styles.heading}>{m.attend_cancel_by_email()}</h2>
      <form className={styles.form} onSubmit={ask}>
        <div className={styles.fields}>
          <div className={styles.field}>
            <Input
              name="cancelEmail"
              type="email"
              autoComplete="email"
              aria-label={m.attend_cancel_email_placeholder()}
              placeholder={m.attend_cancel_email_placeholder()}
              required
            />
          </div>
          <HoneypotInput />
        </div>
        <div className={styles.row}>
          <Button type="submit" disabled={busy}>
            {m.attend_cancel_signup()}
          </Button>
        </div>
      </form>
      {sent === null ? null : (
        <p role="status" className={styles.status}>
          {m.attend_cancel_email_sent({ email: sent })}
        </p>
      )}
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}

/** For bots: people never see it, and screen readers and the keyboard skip it. */
const HoneypotInput = () => (
  <input
    name="subject"
    hidden
    tabIndex={-1}
    autoComplete="off"
    aria-hidden="true"
  />
);

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

/** Why guest inputs were refused, by the input's name. */
type FieldMessages = Partial<Record<GuestField, string>>;

const messagesFor = (problems: ReadonlyArray<GuestProblem>): FieldMessages =>
  Object.fromEntries(
    problems.flatMap((problem) => {
      const field = fieldOf(problem);
      return field === undefined ? [] : [[field, describe(problem)]];
    }),
  );

/**
 * One of a guest's inputs and, while it is refused, its message beneath,
 * which is also the input's description.
 */
function GuestInput({
  name,
  messages,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly name: GuestField;
  readonly messages: FieldMessages;
}) {
  const messageId = useId();
  const message = messages[name];
  return (
    <div className={styles.field}>
      <Input
        {...props}
        name={name}
        aria-invalid={message === undefined ? undefined : true}
        aria-describedby={message === undefined ? undefined : messageId}
      />
      {message === undefined ? null : (
        <p id={messageId} className={styles.error}>
          {message}
        </p>
      )}
    </div>
  );
}

/** A guest's phone number and company, both optional; members aren't asked. */
const GuestContactInputs = (props: {
  readonly given: Given;
  readonly messages: FieldMessages;
}) => (
  <div className={styles.fields}>
    <GuestInput
      name="telephone"
      messages={props.messages}
      type="tel"
      autoComplete="tel"
      defaultValue={props.given.phone}
      aria-label={m.attend_your_phone()}
      placeholder={`${m.attend_your_phone()} ${m.attend_optional()}`}
      maxLength={50}
    />
    <GuestInput
      name="company"
      messages={props.messages}
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
                  defaultChecked={option.id === chosenOption(question, given)}
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
