import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, Layer, Ref } from "effect";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { type DocumentId, SiteSettings } from "../../src/Model.ts";
import { type Kept, NoticesKept } from "../../src/notices/Notifications.ts";
import {
  organizerView,
  problemOf,
  publishedEvent,
  TestLayer,
} from "../helpers.ts";

/** Runs with `Attendance` reading these member domains, rather than the environment's. */
const _withMemberDomains =
  (domains: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(
        // Fresh: the layer the test file shares is built from the environment.
        Layer.fresh(Attendance.layer).pipe(
          Layer.provide(SiteSettings.layer),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                NODE_ENV: "test",
                OAUTH_ALLOWED_DOMAINS: domains,
              }),
            ),
          ),
        ),
      ),
    );

/** The kinds of notice sent about `event`, oldest first. */
const noticesAbout = (event: DocumentId) =>
  Effect.gen(function* () {
    const kept = yield* NoticesKept;
    return (yield* Ref.get(kept))
      .filter((notice) => notice.event === event)
      .map((notice) => notice.kind);
  });

/** The notices that asked `event`'s guests to confirm a cancel, oldest first. */
const cancelRequestsAbout = (event: DocumentId) =>
  Effect.gen(function* () {
    const kept = yield* NoticesKept;
    return (yield* Ref.get(kept)).filter(
      (notice): notice is Extract<Kept, { kind: "cancelRequested" }> =>
        notice.kind === "cancelRequested" && notice.event === event,
    );
  });

const twoHours = 2 * 60 * 60 * 1000;

/** A guest signed up with a signup id of our own, for links made from it. */
const signedUpGuest = (event: DocumentId, email: string, name = "Gina") =>
  Effect.gen(function* () {
    const attendance = yield* Attendance;
    const signup = crypto.randomUUID();
    yield* attendance.attendAsGuest(event, { name, email }, { id: signup });
    return signup;
  });

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Guests", (it) => {
  it.effect(
    "asks the guest found by the typed address, trimmed and in any case, to confirm a cancel within 2 hours (AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const suffix = crypto.randomUUID();
        const signup = yield* signedUpGuest(id, `Gina-${suffix}@Example.org`);

        const before = Date.now();
        yield* attendance.requestCancel(id, ` gina-${suffix}@example.org `);

        const [asked, ...others] = yield* cancelRequestsAbout(id);
        assert.deepStrictEqual(others, []);
        assert.strictEqual(asked?.attendee.id, signup);
        assert.strictEqual(asked?.attendee.email, `Gina-${suffix}@Example.org`);
        assert.isTrue(asked?.attendee.guest);
        assert.approximately(
          asked?.expiresAt ?? 0,
          before + twoHours,
          60 * 1000,
        );
        // Asking cancels nothing.
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }),
  );

  it.effect(
    "finds no guest for an address nobody signed up with, one signed up for another event or a member's, and sends nothing (AC-4)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const other = yield* publishedEvent({ public: true, guests: true });
        const suffix = crypto.randomUUID();
        yield* signedUpGuest(other, `gus-${suffix}@example.org`);
        const mia = new Identity({
          issuer: "https://idp.example",
          subject: `mia-${suffix}`,
          email: `mia-${suffix}@example.org`,
          name: "Mia",
        });
        yield* attendance.attend(id, mia);

        for (const email of [
          `nobody-${suffix}@example.org`,
          `gus-${suffix}@example.org`,
          `mia-${suffix}@example.org`,
        ]) {
          const error = yield* Effect.flip(attendance.requestCancel(id, email));
          assert.strictEqual(error._tag, "SignupRejected");
          assert.deepStrictEqual(problemOf(error), {
            _tag: "NoSignupForEmail",
          });
        }
        assert.deepStrictEqual(yield* cancelRequestsAbout(id), []);
        assert.deepStrictEqual(yield* cancelRequestsAbout(other), []);
      }),
  );

  it.effect(
    "shows the event's title for a good link, and cancels nothing (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const signup = yield* signedUpGuest(
          id,
          `gina-${crypto.randomUUID()}@example.org`,
        );
        const token = attendance.cancelLinkToken(
          id,
          signup,
          Date.now() + twoHours,
        );

        assert.deepStrictEqual(yield* attendance.cancelLink(id, token), {
          title: "Meetup",
        });
        yield* attendance.cancelLink(id, token);
        assert.strictEqual((yield* organizerView(id)).length, 1);
        assert.deepStrictEqual(yield* noticesAbout(id), ["signedUp"]);
      }),
  );

  it.effect(
    "cancels the signup a good link names and tells the guest, leaving the others (AC-6)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const signup = yield* signedUpGuest(
          id,
          `gina-${crypto.randomUUID()}@example.org`,
        );
        yield* signedUpGuest(
          id,
          `gus-${crypto.randomUUID()}@example.org`,
          "Gus",
        );
        const token = attendance.cancelLinkToken(
          id,
          signup,
          Date.now() + twoHours,
        );

        yield* attendance.confirmCancel(id, token);

        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => each?.name),
          ["Gus"],
        );
        assert.deepStrictEqual(yield* noticesAbout(id), [
          "signedUp",
          "signedUp",
          "signupCancelled",
        ]);
      }),
  );

  it.effect("refuses a link that has expired, cancelling nothing (AC-7)", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      const signup = yield* signedUpGuest(
        id,
        `gina-${crypto.randomUUID()}@example.org`,
      );
      const token = attendance.cancelLinkToken(id, signup, Date.now() - 1000);

      for (const use of [
        attendance.cancelLink(id, token),
        attendance.confirmCancel(id, token),
      ] as ReadonlyArray<Effect.Effect<unknown, { readonly _tag: string }>>) {
        const error = yield* Effect.flip(use);
        assert.strictEqual(error._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(error), {
          _tag: "CancelLinkExpired",
        });
      }
      assert.strictEqual((yield* organizerView(id)).length, 1);
    }),
  );

  it.effect(
    "refuses a token with its signature changed, one for another event or text that is no token (AC-7)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const elsewhere = yield* publishedEvent({ public: true, guests: true });
        const signup = yield* signedUpGuest(
          id,
          `gina-${crypto.randomUUID()}@example.org`,
        );
        const expires = Date.now() + twoHours;
        const good = attendance.cancelLinkToken(id, signup, expires);
        const [attendee, at, signature] = good.split(".");
        const changed = `${attendee}.${at}.${signature?.startsWith("A") ? "B" : "A"}${signature?.slice(1)}`;

        for (const token of [
          changed,
          // Signed for another event, then used on this one.
          attendance.cancelLinkToken(elsewhere, signup, expires),
          // The expiry changed to a later time, the signature kept.
          `${attendee}.${expires + 1}.${signature}`,
          "not-a-token",
          "",
        ]) {
          for (const use of [
            attendance.cancelLink(id, token),
            attendance.confirmCancel(id, token),
          ] as ReadonlyArray<
            Effect.Effect<unknown, { readonly _tag: string }>
          >) {
            const error = yield* Effect.flip(use);
            assert.strictEqual(error._tag, "SignupRejected");
            assert.deepStrictEqual(problemOf(error), {
              _tag: "CancelLinkInvalid",
            });
          }
        }
        assert.strictEqual((yield* organizerView(id)).length, 1);
      }),
  );

  it.effect(
    "refuses a link whose signup is gone: cancelled by it, another way or taken off by the organisers (AC-7)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const expires = Date.now() + twoHours;
        const byLink = yield* signedUpGuest(
          id,
          `ann-${crypto.randomUUID()}@example.org`,
        );
        const byToken = yield* signedUpGuest(
          id,
          `ben-${crypto.randomUUID()}@example.org`,
        );
        const byOrganisers = yield* signedUpGuest(
          id,
          `cy-${crypto.randomUUID()}@example.org`,
        );
        const links = [byLink, byToken, byOrganisers].map((signup) =>
          attendance.cancelLinkToken(id, signup, expires),
        );

        yield* attendance.confirmCancel(id, links[0] ?? "");
        yield* attendance.leaveAsGuest(id, attendance.guestToken(byToken));
        yield* attendance.remove(byOrganisers);

        for (const token of links) {
          for (const use of [
            attendance.cancelLink(id, token),
            attendance.confirmCancel(id, token),
          ] as ReadonlyArray<
            Effect.Effect<unknown, { readonly _tag: string }>
          >) {
            const error = yield* Effect.flip(use);
            assert.strictEqual(error._tag, "SignupRejected");
            assert.deepStrictEqual(problemOf(error), {
              _tag: "CancelLinkUsed",
            });
          }
        }
      }),
  );

  it.effect(
    "refuses asking for a cancel link with the hidden field filled in, sending nothing (AC-8)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const email = `gina-${crypto.randomUUID()}@example.org`;
        yield* signedUpGuest(id, email);

        const error = yield* Effect.flip(
          attendance.requestCancel(id, email, "x"),
        );
        assert.strictEqual(error._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(error), { _tag: "FormNotValid" });
        assert.deepStrictEqual(yield* cancelRequestsAbout(id), []);

        // Empty, or left out, asks as before.
        yield* attendance.requestCancel(id, email, "");
        yield* attendance.requestCancel(id, email);
        assert.strictEqual((yield* cancelRequestsAbout(id)).length, 2);
      }),
  );
});
