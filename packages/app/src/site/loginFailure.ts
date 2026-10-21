import {
  type LoginFailure,
  type LoginFailureKind,
  loginFailureMeta,
} from "@skjera/oauth/api";

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

/** The app's own address for a failure, which `readLoginFailure` reads back. */
export const loginFailedPath = (failure: LoginFailure): string => {
  const search = new URLSearchParams({
    kind: failure.kind,
    returnTo: failure.returnTo,
  });
  return `/login-failed?${search}`;
};

/** The failure the server wrote into the page's head. */
export const loginFailureInHead = (head: ParentNode): LoginFailure => {
  const content = (name: string) =>
    head.querySelector(`meta[name="${name}"]`)?.getAttribute("content");
  return readLoginFailure(
    content(loginFailureMeta.kind),
    content(loginFailureMeta.returnTo),
  );
};
