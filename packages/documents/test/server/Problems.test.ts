import { assert, describe as group, it } from "@effect/vitest";
import { describe, type Problem, refused } from "../../src/server/Problems.ts";

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
  it("are said in every language, EventFull among them (AC-3)", () => {
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

  it("go with their English, for logs and other clients", () => {
    assert.deepStrictEqual(refused({ _tag: "TeamNameTaken", name: "Crew" }), {
      problem: { _tag: "TeamNameTaken", name: "Crew" },
      message: "There is already a team called Crew",
    });
  });
});
