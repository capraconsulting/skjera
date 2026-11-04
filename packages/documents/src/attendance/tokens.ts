import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Config, Effect, Option, Redacted } from "effect";

/** What is kept of a guest's token: its hash, never the token. */
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/** How long a link to confirm cancelling by email works. */
export const cancelLinkLife = 2 * 60 * 60 * 1000;

/**
 * Guests' tokens are signed with `SIGNING_SECRET`. Without it, with a
 * secret made up at start, and a warning: links sent before a restart
 * stop working (tokens guests' browsers keep don't).
 */
export const signingSecret = Config.Redacted("SIGNING_SECRET").pipe(
  Config.option,
  Effect.flatMap(
    Option.match({
      onSome: Effect.succeed,
      onNone: () =>
        Effect.as(
          Effect.logWarning(
            "SIGNING_SECRET not set: guests' links in emails stop working on restart",
          ),
          Redacted.make(randomBytes(32).toString("base64url")),
        ),
    }),
  ),
);

/**
 * The token a guest changes and cancels their signup with: derived from
 * it, so it can be put in emails sent later, though only its hash is
 * stored.
 */
export const guestToken = (
  secret: Redacted.Redacted<string>,
  attendee: string,
) =>
  createHmac("sha256", Redacted.value(secret))
    .update(`guest-signup/${attendee}`)
    .digest("base64url");

const cancelSignature = (
  secret: Redacted.Redacted<string>,
  event: string,
  attendee: string,
  expiresAt: number,
) =>
  createHmac("sha256", Redacted.value(secret))
    .update(`guest-cancel/${event}/${attendee}/${expiresAt}`)
    .digest("base64url");

/**
 * The token in a link that cancels: `<attendee>.<expiresAt>.<signature>`,
 * signed, never stored. The event is a string, not a `DocumentId`: the
 * mailer has the event's id as its entity id.
 */
export const cancelLinkToken = (
  secret: Redacted.Redacted<string>,
  event: string,
  attendee: string,
  expiresAt: number,
) =>
  `${attendee}.${expiresAt}.${cancelSignature(secret, event, attendee, expiresAt)}`;

/**
 * The signup a cancel link names, if it is signed for `event` and not
 * expired at `now`; otherwise why not.
 */
export const readCancelLink = (
  secret: Redacted.Redacted<string>,
  event: string,
  token: string,
  now: number,
):
  | { readonly attendee: string }
  | { readonly problem: "CancelLinkInvalid" | "CancelLinkExpired" } => {
  const [attendee = "", expires = "", signature = "", ...rest] =
    token.split(".");
  const given = Buffer.from(signature);
  const expected = Buffer.from(
    cancelSignature(secret, event, attendee, Number(expires)),
  );
  if (
    rest.length > 0 ||
    !/^\d+$/.test(expires) ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    return { problem: "CancelLinkInvalid" };
  }
  if (Number(expires) <= now) return { problem: "CancelLinkExpired" };
  return { attendee };
};
