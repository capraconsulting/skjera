import { m } from "@skjera/i18n/messages";
import { appPaths, appQuery } from "@skjera/paths";
import { Link, redirect, useSearchParams } from "react-router";
import { Button } from "../../components/controls/Button.tsx";
import { loginUrl } from "../../site/client.ts";
import {
  loginFailedPath,
  loginFailureInHead,
  offersLogInAgain,
  readLoginFailure,
} from "../../site/loginFailure.ts";
import styles from "./LoginFailed.module.css";

/**
 * A failed login is answered at the address of OAUTH_REDIRECT_URI with the
 * app and what failed in its head. It moves to an address of the app's own,
 * so a reload (picking a language does one) stays here and doesn't ask the
 * server again.
 */
export const loginFailedRedirect = () =>
  redirect(loginFailedPath(loginFailureInHead(document.head)));

export function LoginFailed() {
  const [search] = useSearchParams();
  const { kind, returnTo } = readLoginFailure(
    search.get(appQuery.kind),
    search.get(appQuery.returnTo),
  );
  const words = {
    denied: [m.site_login_denied_title(), m.site_login_denied()],
    expired: [m.site_login_expired_title(), m.site_login_expired()],
    failed: [m.site_login_failed_title(), m.site_login_failed()],
  }[kind];
  return (
    <section className={styles.failed}>
      <h1 className={styles.title}>{words[0]}</h1>
      <p className={styles.text}>{words[1]}</p>
      <div className={styles.actions}>
        {offersLogInAgain(kind) && (
          <Button
            variant="primary"
            onClick={() => window.location.assign(loginUrl(returnTo))}
          >
            {m.site_login_again()}
          </Button>
        )}
        <Link to={appPaths.root} className={styles.front}>
          {m.site_login_front_page()}
        </Link>
      </div>
    </section>
  );
}
