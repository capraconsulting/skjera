import { m } from "@skjera/i18n/messages";
import type { Identity } from "@skjera/oauth/api";
import { forgetLocalCopies } from "../documents/repo.ts";
import { Button } from "./Button.tsx";
import styles from "./SignedIn.module.css";

/** Who is signed in, and a way to log out. */
export function SignedIn({ me }: { readonly me: Identity }) {
  return (
    <>
      <span className={styles.user} data-testid="me">
        {me.email ?? me.name ?? me.subject}
      </span>
      <form
        method="post"
        action="/auth/logout"
        className={styles.form}
        // Deletes the local copies of what they edited first, so they don't
        // stay behind on a shared computer.
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          void forgetLocalCopies(me)
            .catch(() => undefined)
            .then(() => form.submit());
        }}
      >
        <Button type="submit">{m.common_log_out()}</Button>
      </form>
    </>
  );
}
