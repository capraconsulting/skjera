import {
  describe,
  type GuestProblem,
  type ShownEvent,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import type { FormEvent, ReactNode } from "react";
import { Button } from "../../components/Button.tsx";
import { loginUrl } from "../../site/client.ts";
import type { GuestSignup } from "../../site/guestSignups.ts";
import {
  fieldOf,
  type salesEventForm,
  signupFields,
} from "../../site/signupForm.ts";
import { attendStyles as styles } from "./Attend.tsx";
import {
  ConsentInput,
  type FieldMessages,
  type Given,
  GuestContactInputs,
  GuestInput,
  HoneypotInput,
  JobTitleInput,
  PrivacyLink,
} from "./AttendInputs.tsx";

export const messagesFor = (
  problems: ReadonlyArray<GuestProblem>,
): FieldMessages =>
  Object.fromEntries(
    problems.flatMap((problem) => {
      const field = fieldOf(problem);
      return field === undefined ? [] : [[field, describe(problem)]];
    }),
  );

export function NewGuestSignup(props: {
  readonly event: ShownEvent;
  readonly sales: ReturnType<typeof salesEventForm>;
  readonly messages: FieldMessages;
  readonly questions: ReactNode;
  readonly signUp: (submitted: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className={styles.form}
      {...props.sales.formAttributes}
      onSubmit={props.signUp}
    >
      <div className={styles.fields}>
        <GuestInput
          name={signupFields.firstname}
          messages={props.messages}
          autoComplete="name"
          aria-label={m.attend_your_name()}
          placeholder={m.attend_your_name()}
          required
        />
        <GuestInput
          name={signupFields.email}
          messages={props.messages}
          type="email"
          aria-label={m.attend_your_email()}
          placeholder={m.attend_your_email()}
          required
        />
        <HoneypotInput />
      </div>
      <GuestContactInputs given={{}} messages={props.messages} />
      {props.sales.askJobTitle ? (
        <JobTitleInput messages={props.messages} />
      ) : null}
      {props.questions}
      {props.sales.askConsent ? <ConsentInput /> : null}
      <div className={styles.row}>
        <Button type="submit" variant="primary">
          {m.attend_sign_up()}
        </Button>
        <span>
          {m.attend_or()}{" "}
          <a href={loginUrl(appPaths.event(props.event.id))}>
            {m.attend_log_in()}
          </a>
        </span>
      </div>
      <p className={styles.privacy}>
        <PrivacyLink text={m.attend_privacy_link()} />
      </p>
    </form>
  );
}

export function SignedUp(props: {
  readonly id: string;
  readonly status: string;
  readonly given: Given;
  readonly attendee:
    | { readonly kind: "member" }
    | { readonly kind: "guest"; readonly signup: GuestSignup };
  readonly editing: boolean;
  readonly messages: FieldMessages;
  readonly questions: ReactNode;
  readonly changeable: boolean;
  readonly member: boolean;
  readonly change: (submitted: FormEvent<HTMLFormElement>, id: string) => void;
  readonly keep: () => void;
  readonly edit: (signup?: GuestSignup) => void;
  readonly cancel: (id: string, honeypot?: string) => void;
}) {
  if (props.editing) {
    return (
      <form
        className={styles.form}
        onSubmit={(submitted) => props.change(submitted, props.id)}
        aria-label={m.attend_your_answers()}
      >
        {props.attendee.kind === "guest" ? (
          <GuestContactInputs given={props.given} messages={props.messages} />
        ) : null}
        {props.questions}
        <div className={styles.row}>
          <Button type="submit" variant="primary">
            {m.attend_save_changes()}
          </Button>
          <Button onClick={props.keep}>{m.attend_keep()}</Button>
        </div>
      </form>
    );
  }

  if (props.attendee.kind === "guest") {
    const signup = props.attendee.signup;
    return (
      <form
        className={styles.row}
        onSubmit={(submitted) => {
          submitted.preventDefault();
          const form = new FormData(submitted.currentTarget);
          props.cancel(props.id, String(form.get(signupFields.subject) ?? ""));
        }}
      >
        <p className={styles.status}>{props.status}</p>
        <Button onClick={() => props.edit(signup)}>
          {m.attend_change_answers()}
        </Button>
        <HoneypotInput />
        <Button type="submit">{m.attend_cancel_signup()}</Button>
      </form>
    );
  }

  return (
    <div className={styles.row}>
      <p className={styles.status}>{props.status}</p>
      {props.changeable ? (
        <Button onClick={() => props.edit()}>
          {m.attend_change_answers()}
        </Button>
      ) : null}
      <Button onClick={() => props.cancel(props.id)}>
        {props.member ? m.attend_cancel_attendance() : m.attend_cancel_signup()}
      </Button>
    </div>
  );
}
