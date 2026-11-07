import {
  type LoginFailure,
  type LoginFailureKind,
  loginFailureMeta,
} from "@skjera/oauth/api";
import { appPaths } from "@skjera/paths";

const kinds: ReadonlyArray<LoginFailureKind> = ["denied", "expired", "failed"];

/**
 * A failed login as the server wrote it, in the page's tags or the address:
 * a kind it doesn't know reads as `failed`, and a return that isn't a path
 * of this site as the front page.
 */
export const readLoginFailure = (
  kind: string | null | undefined,
  returnTo: string | null | undefined,
): LoginFailure => ({
  kind: kinds.find((each) => each === kind) ?? "failed",
  returnTo:
    returnTo?.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
});

/** Whether trying again can help: not for an account that isn't allowed. */
export const offersLogInAgain = (kind: LoginFailureKind): boolean =>
  kind !== "denied";

/** The app's own address for a failed login, a page only for visitors. */
const failedPath = appPaths.loginFailed;

/** The app's own address for a failure, which `readLoginFailure` reads back. */
export const loginFailedPath = (failure: LoginFailure): string => {
  return appPaths.loginFailure(failure.kind, failure.returnTo);
};

/**
 * Where a login from the site's header comes back to: the page it was
 * clicked on, with its query, or the front page from the failed-login
 * page. The server's check keeps it on this site.
 */
export const loginReturnFrom = (here: {
  readonly pathname: string;
  readonly search: string;
}): string =>
  here.pathname === failedPath ? "/" : `${here.pathname}${here.search}`;

/** The failure the server wrote into the page's head. */
export const loginFailureInHead = (head: ParentNode): LoginFailure => {
  const content = (name: string) =>
    head.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
  return readLoginFailure(
    content(loginFailureMeta.kind),
    content(loginFailureMeta.returnTo),
  );
};

/** The configured callback path written into the failed-login page. */
export const loginCallbackPathInHead = (head: ParentNode): string => {
  const path = head
    .querySelector(`meta[name="${loginFailureMeta.callbackPath}"]`)
    ?.getAttribute("content");
  return path?.startsWith("/") && !path.startsWith("//")
    ? path
    : "/auth/callback";
};
