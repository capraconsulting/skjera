// What a failed login was, as the page the callback answers with says it:
// the server writes it into the page's head, and the app reads it there.

/** An account not allowed in, a login gone, or an answer that can't be used. */
export type LoginFailureKind = "denied" | "expired" | "failed";

export interface LoginFailure {
  readonly kind: LoginFailureKind;
  /** Where the login was going: a path on this site. */
  readonly returnTo: string;
}

/** The names of the meta tags that carry a failure in the page's head. */
export const loginFailureMeta = {
  kind: "skjera-login-failure",
  returnTo: "skjera-login-return-to",
} as const;
