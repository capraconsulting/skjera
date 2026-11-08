import {
  type AttendeeRow,
  dietaryClosesAt,
  type GuestProblem,
  guestProblems,
  type ShownEvent,
  signupClosesAt,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { appPaths } from "@skjera/paths";
import { type FormEvent, type ReactNode, useState } from "react";
import { Button } from "../../../components/controls/Button.tsx";
import { currentSite } from "../../../i18n.ts";
import { adSourceFor } from "../../../site/adSource.ts";
import { type AppError, loginUrl } from "../../../site/client.ts";
import {
  type GuestSignup,
  guestSignup,
  rememberGuestSignup,
  storedGuestSignup,
} from "../../../site/guestSignups.ts";
import { placesLeft } from "../../../site/signupCount.ts";
import {
  changeFrom,
  fieldOf,
  salesEventForm,
  signupFrom,
} from "../../../site/signupForm.ts";
import { attendees, type GuestCancel } from "../../../sync/tables.ts";
import { formatDateTime } from "../../../time.ts";
import styles from "./Attend.module.css";

export const attendStyles = styles;

import { useHasPassed } from "../event-page/useHasPassed.ts";
import {
  AttendanceInput,
  ConsentInput,
  DietaryInput,
  type FieldMessages,
  type Given,
  QuestionInputs,
} from "./AttendInputs.tsx";
import { CancelByEmail } from "./CancelByEmail.tsx";
import { messagesFor, NewGuestSignup, SignedUp } from "./GuestSignupForm.tsx";

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
  const sales = salesEventForm(event);
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
  const closesAt = signupClosesAt(event.signupDeadline, event.startsAt);
  const closed = useHasPassed(closesAt);
  // After the food deadline, people can still come; they're not asked.
  const foodClosed = useHasPassed(
    dietaryClosesAt(event.foodDeadline, event.signupDeadline, event.startsAt),
  );
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
      (failure: AppError) => {
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
    const signup = signupFrom(
      event,
      form,
      asGuest,
      getLocale(),
      adSourceFor(event.id),
    );
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
      <a href={loginUrl(appPaths.event(event.id))}>
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
              window.location.assign(loginUrl(appPaths.event(event.id)))
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

  const signedUp = (
    id: string,
    status: string,
    given: Given,
    attendee:
      | { readonly kind: "member" }
      | { readonly kind: "guest"; readonly signup: GuestSignup },
  ) => (
    <SignedUp
      id={id}
      status={status}
      given={given}
      attendee={attendee}
      editing={editing}
      messages={messages}
      questions={asked(given)}
      changeable={changeable}
      member={mine !== undefined}
      change={change}
      keep={() => setEditing(false)}
      edit={(signup) =>
        signup === undefined ? setEditing(true) : changeAsGuest(signup)
      }
      cancel={cancel}
    />
  );

  if (props.signedIn) {
    return box(
      <>
        {mine !== undefined ? (
          signedUp(
            mine.id,
            signedUpNow ?? m.attend_you_attending(),
            {
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
            },
            { kind: "member" },
          )
        ) : noMore ? null : (
          <form
            className={styles.form}
            onSubmit={(submitted) => signUp(submitted, false)}
          >
            {asked({}, true)}
            {sales.askConsent ? <ConsentInput /> : null}
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
          <a href={loginUrl(appPaths.event(event.id))}>
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
            <NewGuestSignup
              event={event}
              sales={sales}
              messages={messages}
              questions={asked({}, true)}
              signUp={(submitted) => signUp(submitted, true)}
            />
          ) : (
            signedUp(
              guest.id,
              signedUpNow ?? m.attend_you_signed_up(),
              {
                ...(stored ?? {}),
                online: signups.find((signup) => signup.id === guest.id)
                  ?.online,
              },
              { kind: "guest", signup: guest },
            )
          )}
          {failure}
        </>,
      )}
      {guest === null ? <CancelByEmail eventId={event.id} /> : null}
    </>
  );
}
