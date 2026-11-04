import {
  type AttendeeRow,
  describe,
  type GuestProblem,
  guestProblems,
  type ShownEvent,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button.tsx";
import { currentSite } from "../../i18n.ts";
import { loginUrl } from "../../site/client.ts";
import {
  type GuestSignup,
  guestSignup,
  rememberGuestSignup,
  storedGuestSignup,
} from "../../site/guestSignups.ts";
import { placesLeft } from "../../site/signupCount.ts";
import { changeFrom, fieldOf, signupFrom } from "../../site/signupForm.ts";
import { attendees, type GuestCancel } from "../../sync/tables.ts";
import { formatDateTime } from "../../time.ts";
import styles from "./Attend.module.css";
import {
  AttendanceInput,
  DietaryInput,
  type FieldMessages,
  type Given,
  GuestContactInputs,
  GuestInput,
  HoneypotInput,
  QuestionInputs,
} from "./AttendInputs.tsx";
import { CancelByEmail } from "./CancelByEmail.tsx";
import { useHasPassed } from "./useHasPassed.ts";

/**
 * Signing up to attend an event, and changing one's mind, until sign-up
 * closes. Changes show at once; a refused one is undone, and says why.
 */
export function Attend(props: {
  readonly event: ShownEvent;
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
    const signup = signupFrom(event, form, asGuest, getLocale());
    if (signup.guest !== undefined) {
      const problems = guestProblems(signup.guest);
      if (problems.length > 0) return refuse(problems);
    }
    setSignedUpSince(true);
    const confirmedTo = signup.guest?.email.trim() ?? props.email;
    setLast(
      confirmedTo === undefined || confirmedTo === ""
        ? null
        : { kind: "signedUp", email: confirmedTo },
    );
    if (!asGuest) setGiven(signup);
    settle(
      attendees.collection.insert(
        {
          id: crypto.randomUUID(),
          eventId: event.id,
          signedUpAt: new Date(),
          changedAt: new Date(),
          mine: !asGuest,
          online: signup.online === true,
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
    const changed = changeFrom(event, form, id === guest?.id);
    if (id === guest?.id) {
      const problems = guestProblems(changed);
      if (problems.length > 0) return refuse(problems);
    }
    const transaction = attendees.collection.update(
      id,
      { metadata: changed },
      (draft) => {
        draft.changedAt = new Date();
        if (changed.online !== undefined) draft.online = changed.online;
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

  const closes = (
    <p className={styles.closes}>
      {m.attend_closes({ when: formatDateTime(closesAt, event.timeZone) })}
      {food === null ? null : ` ${food}`}
    </p>
  );

  // Members only, to someone not logged in: they log in to sign up. They
  // get no signups of it, so the box shows nothing but its heading.
  const membersOnly = !props.signedIn && !event.isPublic;

  /** The sign-up box: what every branch shows, then the branch's own. */
  const box = (own: ReactNode) => (
    <section className={styles.box} aria-label={m.attend_region()}>
      <h2 className={styles.heading}>{m.attend_region()}</h2>
      {membersOnly ? null : (
        <>
          {count}
          {gone}
          {cancelled}
          {closed ? null : (
            <>
              {closes}
              {places}
            </>
          )}
        </>
      )}
      {own}
    </section>
  );

  if (membersOnly) {
    return box(
      <>
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
      </>,
    );
  }

  if (closed) {
    return box(
      <>
        {mine !== undefined || guest !== null ? (
          <p className={styles.status}>
            {mine !== undefined
              ? m.attend_you_attending()
              : m.attend_you_signed_up()}
          </p>
        ) : null}
        <p className={styles.closes}>{m.attend_closed()}</p>
        {food === null ? null : <p className={styles.closes}>{food}</p>}
      </>,
    );
  }

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
    return box(
      <>
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
      </>,
    );
  }

  if (!event.allowGuests) {
    return box(
      noMore ? (
        logInWhenFull
      ) : (
        <p className={styles.row}>
          <a href={loginUrl(`/events/${event.id}`)}>
            {m.attend_log_in_to_attend()}
          </a>
        </p>
      ),
    );
  }

  return (
    <>
      {box(
        <>
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
                online: signups.find((signup) => signup.id === guest.id)
                  ?.online,
              },
              true,
            )
          )}
          {failure}
        </>,
      )}
      {guest === null ? <CancelByEmail eventId={event.id} /> : null}
    </>
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

const messagesFor = (problems: ReadonlyArray<GuestProblem>): FieldMessages =>
  Object.fromEntries(
    problems.flatMap((problem) => {
      const field = fieldOf(problem);
      return field === undefined ? [] : [[field, describe(problem)]];
    }),
  );
