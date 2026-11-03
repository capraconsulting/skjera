import { assert, describe as group, it } from "@effect/vitest";
import { describe, type Problem, refused } from "../../src/api/Problems.ts";

const question = "Towel size";

/** One of each problem. */
const problems: ReadonlyArray<Problem> = [
  { _tag: "SignupClosed" },
  { _tag: "GuestsNotAllowed" },
  { _tag: "EmailTaken" },
  { _tag: "EventFull" },
  { _tag: "DietaryTooLong" },
  { _tag: "AttendanceMissing" },
  { _tag: "AnswerTooLong", question },
  { _tag: "AnswerMissing", question },
  { _tag: "TickMissing", question },
  { _tag: "AnswerUnknown", question },
  { _tag: "LogInToAttend" },
  { _tag: "LogInOrGuest" },
  { _tag: "MemberEmail" },
  { _tag: "GuestNameTooShort" },
  { _tag: "GuestCompanyTooShort" },
  { _tag: "GuestPhoneInvalid" },
  { _tag: "FormNotValid" },
  { _tag: "TooManyAttempts" },
  { _tag: "NoSignupForEmail" },
  { _tag: "CancelLinkExpired" },
  { _tag: "CancelLinkUsed" },
  { _tag: "CancelLinkInvalid" },
  { _tag: "MissingToPublish", fields: ["title"] },
  { _tag: "EndsBeforeStart" },
  { _tag: "DeadlineAfterStart" },
  { _tag: "FoodDeadlineAfterClose" },
  { _tag: "QuestionWithoutText" },
  { _tag: "ChoiceWithoutOptions" },
  { _tag: "MixedTimeZones" },
  { _tag: "StreamLinkNotWeb" },
  { _tag: "UnknownVersion" },
  { _tag: "TeamNameLength" },
  { _tag: "TeamNameTaken", name: "Crew" },
  { _tag: "ImageTooBig", maxMb: 10 },
  { _tag: "ImageFormat" },
];

group("Problems", () => {
  it("are said in every language, EventFull among them", () => {
    for (const locale of ["en", "nb", "nn"] as const) {
      const said = problems.map((problem) => describe(problem, locale));
      for (const text of said) assert.isAbove(text.length, 3);
      // Each its own.
      assert.strictEqual(new Set(said).size, said.length);
    }
  });

  it("list what's missing, as each language does", () => {
    const missing: Problem = {
      _tag: "MissingToPublish",
      fields: ["title", "start", "end", "place"],
    };
    assert.strictEqual(
      describe(missing, "en"),
      "Add a title, a start time, an end time and a place before publishing",
    );
    assert.strictEqual(
      describe(missing, "nb"),
      "Legg til en tittel, et starttidspunkt, et sluttidspunkt og et sted før du publiserer",
    );
    assert.strictEqual(
      describe({ _tag: "AnswerMissing", question }, "nn"),
      "Svar på «Towel size»",
    );
  });

  it("tell a member who signs up as a guest to log in (AC-1)", () => {
    const member: Problem = { _tag: "MemberEmail" };
    assert.strictEqual(
      describe(member, "nb"),
      "Logg deg inn for å melde deg på arrangementet!",
    );
    assert.strictEqual(
      describe(member, "nn"),
      "Logg deg inn for å melde deg på arrangementet!",
    );
    assert.strictEqual(
      describe(member, "en"),
      "Log in to sign up for the event!",
    );
  });

  it("say Skjer's sentence when there have been too many attempts (AC-3)", () => {
    const tooMany: Problem = { _tag: "TooManyAttempts" };
    assert.strictEqual(
      describe(tooMany, "nb"),
      "Du har nådd grensen for antall forsøk. Vennligst vent en stund før du prøver igjen.",
    );
    // Nynorsk and English are sentences of their own.
    assert.notStrictEqual(describe(tooMany, "nn"), describe(tooMany, "nb"));
    assert.notStrictEqual(describe(tooMany, "en"), describe(tooMany, "nb"));
  });

  it("say Skjer's sentence when no signup is found for an address (AC-4)", () => {
    const none: Problem = { _tag: "NoSignupForEmail" };
    assert.strictEqual(
      describe(none, "nb"),
      "Vi finner dessverre ingen opplysninger om påmelding med denne e-posten.",
    );
  });

  it("go with their English, for logs and other clients", () => {
    assert.deepStrictEqual(refused({ _tag: "TeamNameTaken", name: "Crew" }), {
      problem: { _tag: "TeamNameTaken", name: "Crew" },
      message: "There is already a team called Crew",
    });
  });
});
