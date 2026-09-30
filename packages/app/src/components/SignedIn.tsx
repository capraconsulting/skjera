import type { Identity } from "@skjera/oauth/api";
import { Button } from "./Button.tsx";
import styles from "./SignedIn.module.css";

/** Who is signed in, and a way to log out. */
export function SignedIn({ me }: { readonly me: Identity }) {
  return (
    <>
      <span className={styles.user} data-testid="me">
        {me.email ?? me.name ?? me.subject}
      </span>
      <form method="post" action="/auth/logout" className={styles.form}>
        <Button type="submit">Log out</Button>
      </form>
    </>
  );
}
