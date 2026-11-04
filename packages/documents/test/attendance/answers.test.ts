import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { answersFor } from "../../src/attendance/answers.ts";
import type { Answer, Question } from "../../src/Model.ts";

const id = (n: number) => `0198a1b2-0000-7000-8000-00000000000${n}`;

const text = (required: boolean): Question => ({
  id: id(1),
  type: "text",
  text: "Allergies?",
  required,
  options: [],
});
const checkbox = (required: boolean): Question => ({
  id: id(2),
  type: "checkbox",
  text: "Rules",
  required,
  options: [],
});
const choice = (required: boolean): Question => ({
  id: id(3),
  type: "choice",
  text: "Which day?",
  required,
  options: [
    { id: id(4), text: "Monday" },
    { id: id(5), text: "Tuesday" },
  ],
});

/** The problem an answer was refused with, or the answers stored. */
const checked = (
  questions: ReadonlyArray<Question>,
  answers?: Record<string, string | boolean>,
): { stored?: ReadonlyArray<Answer>; problem?: string } => {
  return Effect.runSync(
    answersFor(questions, answers).pipe(
      Effect.match({
        onSuccess: (stored) => ({ stored }),
        onFailure: (error) => ({ problem: error.problem._tag }),
      }),
    ),
  );
};

describe("answersFor", () => {
  it("keeps a text answer trimmed (AC-2)", () => {
    assert.deepStrictEqual(checked([text(false)], { [id(1)]: "  Nuts  " }), {
      stored: [
        { id: id(1), question: "Allergies?", answer: "Nuts", value: "Nuts" },
      ],
    });
  });

  it("leaves a blank optional text out and refuses a blank required one (AC-2)", () => {
    assert.deepStrictEqual(checked([text(false)], { [id(1)]: "   " }), {
      stored: [],
    });
    assert.deepStrictEqual(checked([text(false)]), { stored: [] });
    assert.deepStrictEqual(checked([text(true)], { [id(1)]: "   " }), {
      problem: "AnswerMissing",
    });
    assert.deepStrictEqual(checked([text(true)]), {
      problem: "AnswerMissing",
    });
  });

  it("refuses a text over 1000 characters, and takes one of exactly 1000 (AC-2)", () => {
    assert.deepStrictEqual(
      checked([text(false)], { [id(1)]: "x".repeat(1001) }),
      { problem: "AnswerTooLong" },
    );
    assert.strictEqual(
      checked([text(false)], { [id(1)]: "x".repeat(1000) }).problem,
      undefined,
    );
  });

  it("keeps a checkbox as Yes or No, and refuses a required one unticked (AC-2)", () => {
    const yes = { id: id(2), question: "Rules", answer: "Yes", value: true };
    const no = { id: id(2), question: "Rules", answer: "No", value: false };
    assert.deepStrictEqual(checked([checkbox(true)], { [id(2)]: true }), {
      stored: [yes],
    });
    assert.deepStrictEqual(checked([checkbox(false)], { [id(2)]: true }), {
      stored: [yes],
    });
    assert.deepStrictEqual(checked([checkbox(false)], { [id(2)]: false }), {
      stored: [no],
    });
    assert.deepStrictEqual(checked([checkbox(false)]), { stored: [no] });
    assert.deepStrictEqual(checked([checkbox(true)], { [id(2)]: false }), {
      problem: "TickMissing",
    });
    assert.deepStrictEqual(checked([checkbox(true)]), {
      problem: "TickMissing",
    });
  });

  it("keeps a choice with its option's text and id (AC-2)", () => {
    assert.deepStrictEqual(checked([choice(true)], { [id(3)]: id(5) }), {
      stored: [
        { id: id(3), question: "Which day?", answer: "Tuesday", value: id(5) },
      ],
    });
  });

  it("refuses a choice that is not among the options (AC-2)", () => {
    assert.deepStrictEqual(checked([choice(false)], { [id(3)]: id(9) }), {
      problem: "AnswerUnknown",
    });
  });

  it("refuses a required choice not picked, and leaves an optional one out (AC-2)", () => {
    assert.deepStrictEqual(checked([choice(true)]), {
      problem: "AnswerMissing",
    });
    assert.deepStrictEqual(checked([choice(true)], { [id(3)]: "" }), {
      problem: "AnswerMissing",
    });
    assert.deepStrictEqual(checked([choice(false)]), { stored: [] });
    assert.deepStrictEqual(checked([choice(false)], { [id(3)]: "" }), {
      stored: [],
    });
  });

  it("ignores answers to questions the event does not ask (AC-2)", () => {
    assert.deepStrictEqual(
      checked([text(false)], { [id(1)]: "Nuts", [id(8)]: "Other" }).stored,
      [{ id: id(1), question: "Allergies?", answer: "Nuts", value: "Nuts" }],
    );
    assert.deepStrictEqual(checked([], { [id(8)]: "Other" }), { stored: [] });
  });

  it("stores the answers in the order of the questions (AC-2)", () => {
    const stored = checked([checkbox(false), text(false)], {
      [id(1)]: "Nuts",
      [id(2)]: true,
    }).stored;
    assert.deepStrictEqual(
      stored?.map((answer) => answer.id),
      [id(2), id(1)],
    );
  });
});
