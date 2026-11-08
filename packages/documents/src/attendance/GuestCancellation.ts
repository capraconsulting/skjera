import { Clock, Effect, type Redacted } from "effect";
import type { SqlClient, Statement } from "effect/sql";
import { type EventNotFound, SignupRejected } from "../api/errors.ts";
import { refused } from "../api/Problems.ts";
import type { Audience, DocumentId } from "../Model.ts";
import {
  type CancelNotice,
  type Notice,
  type Signup,
  signupColumns,
  tell,
} from "../notices/Notifications.ts";
import { notByBot } from "./GuestAttendance.ts";
import { cancelLinkLife, readCancelLink } from "./tokens.ts";

type Dependencies = {
  readonly sql: SqlClient.SqlClient;
  readonly secret: Redacted.Redacted<string>;
  readonly signupOpen: Statement.Fragment;
  readonly rules: (
    event: DocumentId,
    audience: Audience,
  ) => Effect.Effect<unknown, EventNotFound | SignupRejected>;
  readonly notifications: {
    readonly cancelRequested: (notice: CancelNotice) => Effect.Effect<void>;
    readonly signupCancelled: (notice: Notice) => Effect.Effect<void>;
  };
  readonly tellCancelled: (
    event: DocumentId,
    signups: ReadonlyArray<Signup>,
  ) => Effect.Effect<void>;
  readonly closed: SignupRejected;
};

export const guestCancellation = ({
  sql,
  secret,
  signupOpen,
  rules,
  notifications,
  tellCancelled,
  closed,
}: Dependencies) => {
  const cancelRefusal = (
    problem: "CancelLinkInvalid" | "CancelLinkExpired" | "CancelLinkUsed",
  ) => new SignupRejected(refused({ _tag: problem }));

  /**
   * The signup a cancel link names, if the link is good: signed for this
   * event, not expired, and its signup still there.
   */
  const cancelTarget = Effect.fn(function* (event: DocumentId, token: string) {
    const link = readCancelLink(
      secret,
      event,
      token,
      yield* Clock.currentTimeMillis,
    );
    if ("problem" in link) return yield* cancelRefusal(link.problem);
    const { attendee } = link;
    // A deleted event has no signups to find: its link is used up.
    const [found] = yield* sql<{ title: string; open: boolean }>`
      SELECT e.title, ${signupOpen} AS open
      FROM attendees a JOIN events e ON e.id = a.event_id
      WHERE a.id = ${attendee}::uuid AND a.event_id = ${event}
        AND a.user_issuer IS NULL AND e.deleted_at IS NULL
    `.pipe(Effect.orDie);
    if (found === undefined) return yield* cancelRefusal("CancelLinkUsed");
    if (!found.open) return yield* closed;
    return { attendee, title: found.title };
  });

  const requestCancel = Effect.fn("Attendance.requestCancel")(function* (
    event: DocumentId,
    email: string,
    honeypot?: string,
  ) {
    yield* notByBot(honeypot);
    yield* rules(event, "anyone");
    // Only a guest's signup: members log in to cancel.
    const found = yield* sql<Signup>`
      SELECT ${signupColumns(sql)}
      FROM attendees
      WHERE event_id = ${event} AND user_issuer IS NULL
        AND lower(email) = lower(${email.trim()})
    `.pipe(Effect.orDie);
    if (found.length === 0) {
      return yield* new SignupRejected(refused({ _tag: "NoSignupForEmail" }));
    }
    const expiresAt = (yield* Clock.currentTimeMillis) + cancelLinkLife;
    yield* tell(found, (attendee) =>
      notifications.cancelRequested({ event, attendee, expiresAt }),
    );
  });

  const cancelLink = Effect.fn("Attendance.cancelLink")(function* (
    event: DocumentId,
    token: string,
  ) {
    const { title } = yield* cancelTarget(event, token);
    return { title };
  });

  const confirmCancel = Effect.fn("Attendance.confirmCancel")(function* (
    event: DocumentId,
    token: string,
  ) {
    const { attendee } = yield* cancelTarget(event, token);
    const cancelled = yield* Effect.gen(function* () {
      const deleted = yield* sql<Signup>`
        DELETE FROM attendees
        WHERE id = ${attendee}::uuid AND event_id = ${event}
          AND user_issuer IS NULL
        RETURNING ${signupColumns(sql)}
      `;
      yield* tell(deleted, (each) =>
        notifications.signupCancelled({ event, attendee: each }),
      );
      yield* tellCancelled(event, deleted);
      return deleted.length;
    }).pipe(sql.withTransaction, Effect.orDie);
    // Gone since it was checked: cancelled by another press of the button.
    if (cancelled === 0) return yield* cancelRefusal("CancelLinkUsed");
  }, Effect.uninterruptible);

  return { requestCancel, cancelLink, confirmCancel };
};
