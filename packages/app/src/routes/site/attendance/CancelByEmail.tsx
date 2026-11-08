import type { DocumentId } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { type FormEvent, useState } from "react";
import { Button } from "../../../components/controls/Button.tsx";
import { Input } from "../../../components/controls/Input.tsx";
import { sayWhy } from "../../../problems.ts";
import { requestCancelByEmail } from "../../../site/guestSignups.ts";
import { signupFields } from "../../../site/signupForm.ts";
import { attendStyles as styles } from "./Attend.tsx";
import { HoneypotInput } from "./AttendInputs.tsx";

/**
 * Cancelling without the signup's own link, for a guest who has lost the
 * email: a link that cancels is sent to the address they signed up with.
 * It has a region of its own, apart from the sign-up box.
 */
export function CancelByEmail(props: { readonly eventId: DocumentId }) {
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
      String(form.get(signupFields.subject) ?? ""),
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
