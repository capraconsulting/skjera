import { assert, layer } from "@effect/vitest";
import { Identity } from "@skjera/oauth/api";
import { ConfigProvider, Effect, Layer, Option, Ref } from "effect";
import { SqlClient } from "effect/sql";
import { Attendance } from "../../src/attendance/Attendance.ts";
import { Documents } from "../../src/events/Documents.ts";
import type { DocumentId } from "../../src/Model.ts";
import { type Kept, NoticesKept } from "../../src/notices/Notifications.ts";
import {
  alice,
  bob,
  organizerView,
  problemOf,
  publishedEvent,
  setQuestions,
  signups,
  TestLayer,
} from "../helpers.ts";

/** Runs with `Attendance` reading these member domains, rather than the environment's. */
const withMemberDomains =
  (domains: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provide(
        // Fresh: the layer the test file shares is built from the environment.
        Layer.fresh(Attendance.layer).pipe(
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ OAUTH_ALLOWED_DOMAINS: domains }),
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
  it.effect("lets guests sign up where allowed, once per email", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const closed = yield* publishedEvent({ public: true, guests: false });
      const rejected = yield* Effect.flip(
        attendance.attendAsGuest(closed, {
          name: "Gina",
          email: "gina@example.org",
        }),
      );
      assert.strictEqual(rejected._tag, "SignupRejected");

      const id = yield* publishedEvent({ public: true, guests: true });
      const token = yield* attendance.attendAsGuest(id, {
        name: " Gina ",
        email: "gina@example.org",
      });
      const again = yield* Effect.flip(
        attendance.attendAsGuest(id, {
          name: "Gina again",
          email: "GINA@example.org",
        }),
      );
      assert.strictEqual(again._tag, "SignupRejected");
      yield* attendance.attend(id, bob);

      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.name, each?.guest]),
        [
          ["Gina", true],
          ["bob", false],
        ],
      );
      // Anyone else can count them, but not see who they are.
      assert.deepStrictEqual(
        (yield* signups(id, Option.none())).map((row) => row.details),
        [null, null],
      );

      // Only the token given to the guest cancels their signup.
      const wrong = yield* Effect.flip(attendance.leaveAsGuest(id, "guess"));
      assert.strictEqual(wrong._tag, "SignupNotFound");
      const elsewhere = yield* Effect.flip(
        attendance.leaveAsGuest(closed, token),
      );
      assert.strictEqual(elsewhere._tag, "SignupNotFound");
      yield* attendance.leaveAsGuest(id, token);
      assert.strictEqual((yield* signups(id, Option.none())).length, 1);
    }),
  );

  it.effect(
    "refuses a guest's sign-up with the hidden field filled in, saving and sending nothing (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const error = yield* Effect.flip(
          attendance.attendAsGuest(
            id,
            { name: "Gina", email: "gina@example.org" },
            { honeypot: "x" },
          ),
        );
        assert.strictEqual(error._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(error), { _tag: "FormNotValid" });
        assert.deepStrictEqual(yield* organizerView(id), []);
        assert.deepStrictEqual(yield* noticesAbout(id), []);
      }),
  );

  it.effect(
    "signs a guest up whose hidden field is empty or left out (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { honeypot: "" },
        );
        yield* attendance.attendAsGuest(id, {
          name: "Gus",
          email: "gus@example.org",
        });
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => each?.name),
          ["Gina", "Gus"],
        );
      }),
  );

  it.effect(
    "refuses a guest's cancel with the hidden field filled in, keeping the signup and sending nothing (AC-2)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const token = yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
        });
        const error = yield* Effect.flip(
          attendance.leaveAsGuest(id, token, "x"),
        );
        assert.strictEqual(error._tag, "SignupRejected");
        assert.deepStrictEqual(problemOf(error), { _tag: "FormNotValid" });
        assert.strictEqual((yield* organizerView(id)).length, 1);
        assert.deepStrictEqual(yield* noticesAbout(id), ["signedUp"]);

        // Empty, or left out, cancels as before.
        yield* attendance.leaveAsGuest(id, token, "");
        assert.strictEqual((yield* organizerView(id)).length, 0);
        const other = yield* attendance.attendAsGuest(id, {
          name: "Gus",
          email: "gus@example.org",
        });
        yield* attendance.leaveAsGuest(id, other);
        assert.strictEqual((yield* organizerView(id)).length, 0);
        assert.deepStrictEqual(yield* noticesAbout(id), [
          "signedUp",
          "signupCancelled",
          "signedUp",
          "signupCancelled",
        ]);
      }),
  );

  it.effect("keeps a guest's phone number and company, trimmed", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
        phone: " +47 900 00 000 ",
        company: " Acme ",
      });
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [["+47 900 00 000", "Acme"]],
      );
    }),
  );

  it.effect("keeps nothing for a phone number and company left blank", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attendAsGuest(id, {
        name: "Gina",
        email: "gina@example.org",
        company: "  ",
      });
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [[null, null]],
      );
    }),
  );

  it.effect(
    "keeps the ad a guest and a member came from, trimmed, a blank value left out (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { source: { utm_source: " linkedin ", utm_term: "  " } },
        );
        yield* attendance.attend(id, bob, { source: { fbclid: "F" } });
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => each?.source),
          [{ utm_source: "linkedin" }, { fbclid: "F" }],
        );
      }),
  );

  it.effect(
    "keeps a guest's and a member's consent, and false when none was sent (AC-2, AC-3)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { consent: true },
        );
        yield* attendance.attendAsGuest(id, {
          name: "Gary",
          email: "gary@example.org",
        });
        yield* attendance.attend(id, bob, { consent: true });
        yield* attendance.attend(id, alice);
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.guest,
            each?.consent,
          ]),
          [
            [true, true],
            [true, false],
            [false, true],
            [false, false],
          ],
        );
      }),
  );

  it.effect(
    "keeps SQL null for a sign-up with no source, or only blank values (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org" },
          { source: { utm_source: "  ", fbclid: "" } },
        );
        yield* attendance.attend(id, bob);
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => each?.source),
          [null, null],
        );
        const rows = yield* sql<{ readonly missing: boolean }>`
          SELECT ad_source IS NULL AS missing FROM attendees
          WHERE event_id = ${id}`;
        assert.deepStrictEqual(
          rows.map((row) => row.missing),
          [true, true],
        );
      }),
  );

  it.effect(
    "lets a guest change their phone number and company, and keeps them when left out",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const token = yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          phone: "900 00 111",
          company: "Acme",
        });
        const contact = () =>
          Effect.map(organizerView(id), (rows) =>
            rows.map((each) => [each?.phone, each?.company]),
          );

        yield* attendance.change(
          id,
          { cancelToken: token },
          { phone: " 911 22 333 ", company: "Initech" },
        );
        assert.deepStrictEqual(yield* contact(), [["911 22 333", "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, { phone: "" });
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);

        yield* attendance.change(id, { cancelToken: token }, {});
        assert.deepStrictEqual(yield* contact(), [[null, "Initech"]]);
      }),
  );

  it.effect("gives a member's signup no phone number or company", () =>
    Effect.gen(function* () {
      const attendance = yield* Attendance;
      const id = yield* publishedEvent({ public: true, guests: true });
      yield* attendance.attend(id, bob);
      yield* attendance.change(
        id,
        { user: bob },
        { phone: "111", company: "Acme" },
      );
      assert.deepStrictEqual(
        (yield* organizerView(id)).map((each) => [each?.phone, each?.company]),
        [[null, null]],
      );
    }),
  );

  it.effect(
    "gives a guest their own signup for their token, and no one else's",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const [where, size] = [crypto.randomUUID(), crypto.randomUUID()];
        const [small, large] = [crypto.randomUUID(), crypto.randomUUID()];
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) =>
            setQuestions(event, [
              { id: where, type: "text", text: "Where did you hear of it?" },
              {
                id: size,
                type: "choice",
                text: "Towel size",
                required: true,
                options: [
                  { id: small, text: "Small" },
                  { id: large, text: "Large" },
                ],
              },
            ]),
        });
        const gina = yield* attendance.attendAsGuest(
          id,
          {
            name: "Gina",
            email: "gina@example.org",
            phone: "900 00 111",
            company: "Acme",
          },
          { answers: { [where]: "A poster", [size]: small } },
        );
        const gus = yield* attendance.attendAsGuest(
          id,
          { name: "Gus", email: "gus@example.org" },
          { answers: { [size]: large } },
        );

        const ginas = yield* attendance.guestSignup(id, gina);
        const guss = yield* attendance.guestSignup(id, gus);
        assert.deepStrictEqual(
          { ...ginas, id: undefined },
          {
            id: undefined,
            phone: "900 00 111",
            company: "Acme",
            answers: { [where]: "A poster", [size]: small },
          },
        );
        assert.deepStrictEqual(
          { ...guss, id: undefined },
          {
            id: undefined,
            phone: null,
            company: null,
            answers: { [size]: large },
          },
        );
        assert.notStrictEqual(ginas.id, guss.id);

        // A token that was not given, or the guest's own on another event.
        const other = yield* publishedEvent({ public: true, guests: true });
        for (const [event, token] of [
          [id, "guess"],
          [other, gina],
        ] as const) {
          const error = yield* Effect.flip(
            attendance.guestSignup(event, token),
          );
          assert.strictEqual(error._tag, "SignupNotFound");
        }
      }),
  );

  it.effect(
    "finds no signup once it is cancelled, removed or its event deleted",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const notFound = (event: DocumentId, token: string) =>
          Effect.map(
            Effect.flip(attendance.guestSignup(event, token)),
            (error) => error._tag,
          );
        const guest = (name: string) =>
          attendance.attendAsGuest(id, {
            name,
            email: `${name.toLowerCase()}@example.org`,
          });

        const cancelled = yield* guest("Gina");
        yield* attendance.guestSignup(id, cancelled);
        yield* attendance.leaveAsGuest(id, cancelled);
        assert.strictEqual(yield* notFound(id, cancelled), "SignupNotFound");

        const removed = yield* guest("Gus");
        yield* attendance.remove(
          (yield* attendance.guestSignup(id, removed)).id,
        );
        assert.strictEqual(yield* notFound(id, removed), "SignupNotFound");

        const staying = yield* guest("Greta");
        yield* attendance.guestSignup(id, staying);
        yield* (yield* Documents).delete(id, alice);
        assert.strictEqual(yield* notFound(id, staying), "SignupNotFound");
      }),
  );

  it.effect(
    "keeps a guest's signup as it was when what was read is saved back",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const [where, swim] = [crypto.randomUUID(), crypto.randomUUID()];
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) =>
            setQuestions(event, [
              { id: where, type: "text", text: "Where did you hear of it?" },
              {
                id: swim,
                type: "checkbox",
                text: "I accept the risks of swimming",
                required: true,
              },
            ]),
        });
        const token = yield* attendance.attendAsGuest(
          id,
          { name: "Gina", email: "gina@example.org", phone: "900 00 111" },
          { answers: { [where]: "A poster", [swim]: true } },
        );

        const before = yield* attendance.guestSignup(id, token);
        yield* attendance.change(
          id,
          { cancelToken: token },
          {
            answers: before.answers,
            phone: before.phone ?? "",
            company: before.company ?? "",
          },
        );

        assert.deepStrictEqual(
          yield* attendance.guestSignup(id, token),
          before,
        );
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.phone,
            each?.company,
          ]),
          [["900 00 111", null]],
        );
      }),
  );

  it.effect(
    "refuses a guest with a member's email address, and keeps nothing (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        for (const email of [
          "bob@example.com",
          "Bob@EXAMPLE.com",
          " bob@example.com ",
        ]) {
          const error = yield* Effect.flip(
            attendance.attendAsGuest(id, { name: "Bob", email }),
          );
          assert.strictEqual(error._tag, "SignupRejected");
          assert.deepStrictEqual(problemOf(error), { _tag: "MemberEmail" });
        }
        assert.strictEqual((yield* signups(id, Option.none())).length, 0);
      }).pipe(withMemberDomains("example.com")),
  );

  it.effect(
    "signs up a guest on another domain or a subdomain of a member's (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        for (const email of ["gina@example.org", "gina@mail.example.com"]) {
          yield* attendance.attendAsGuest(id, { name: "Gina", email });
        }
        assert.strictEqual((yield* signups(id, Option.none())).length, 2);
      }).pipe(withMemberDomains("example.com")),
  );

  it.effect(
    "refuses no email address when no member domains are set (AC-1)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        yield* attendance.attendAsGuest(id, {
          name: "Bob",
          email: "bob@example.com",
        });
        assert.strictEqual((yield* signups(id, Option.none())).length, 1);
      }).pipe(withMemberDomains("")),
  );

  it.effect(
    "refuses a name, company or phone number the form would have refused, and keeps nothing (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const gina = { name: "Gina", email: "gina@example.org" };
        for (const [given, problem] of [
          [{ name: "G" }, "GuestNameTooShort"],
          [{ company: "A" }, "GuestCompanyTooShort"],
          [{ phone: "111" }, "GuestPhoneInvalid"],
        ] as const) {
          const error = yield* Effect.flip(
            attendance.attendAsGuest(id, { ...gina, ...given }),
          );
          assert.strictEqual(error._tag, "SignupRejected");
          assert.deepStrictEqual(problemOf(error), { _tag: problem });
        }
        assert.strictEqual((yield* signups(id, Option.none())).length, 0);
      }),
  );

  it.effect(
    "refuses a guest's change to a phone number or company the form would have refused, and keeps what was stored (AC-5)",
    () =>
      Effect.gen(function* () {
        const attendance = yield* Attendance;
        const id = yield* publishedEvent({ public: true, guests: true });
        const token = yield* attendance.attendAsGuest(id, {
          name: "Gina",
          email: "gina@example.org",
          phone: "900 00 000",
          company: "Acme",
        });
        for (const [given, problem] of [
          [{ phone: "111" }, "GuestPhoneInvalid"],
          [{ company: "A" }, "GuestCompanyTooShort"],
        ] as const) {
          const error = yield* Effect.flip(
            attendance.change(id, { cancelToken: token }, given),
          );
          assert.strictEqual(error._tag, "SignupRejected");
          assert.deepStrictEqual(problemOf(error), { _tag: problem });
        }
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.phone,
            each?.company,
          ]),
          [["900 00 000", "Acme"]],
        );

        // A member's phone number and company are ignored, never refused.
        yield* attendance.attend(id, bob);
        yield* attendance.change(
          id,
          { user: bob },
          { phone: "111", company: "A" },
        );
        assert.deepStrictEqual(
          (yield* organizerView(id)).map((each) => [
            each?.phone,
            each?.company,
          ]),
          [
            ["900 00 000", "Acme"],
            [null, null],
          ],
        );
      }),
  );
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
