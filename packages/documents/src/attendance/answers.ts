import { Effect } from "effect";
import { SignupRejected } from "../api/errors.ts";
import { type Problem, refused } from "../api/Problems.ts";
import {
  type Answer,
  type Answers,
  type Question,
  writtenAnswerLength,
} from "../Model.ts";

/**
 * Answers checked against the questions, in the words asked and picked:
 * what is stored with the signup. Answers to other questions are ignored.
 */
export const answersFor = (
  questions: ReadonlyArray<Question>,
  answers: Answers = {},
): Effect.Effect<ReadonlyArray<Answer>, SignupRejected> => {
  const stored: Array<Answer> = [];
  for (const question of questions) {
    const value = answers[question.id];
    const reject = (problem: Problem) =>
      Effect.fail(new SignupRejected(refused(problem)));
    switch (question.type) {
      case "text": {
        const text = typeof value === "string" ? value.trim() : "";
        if (text.length > writtenAnswerLength) {
          return reject({ _tag: "AnswerTooLong", question: question.text });
        }
        if (text === "" && question.required) {
          return reject({ _tag: "AnswerMissing", question: question.text });
        }
        if (text !== "") {
          stored.push({
            id: question.id,
            question: question.text,
            answer: text,
            value: text,
          });
        }
        break;
      }
      case "checkbox": {
        const ticked = value === true;
        if (!ticked && question.required) {
          return reject({ _tag: "TickMissing", question: question.text });
        }
        stored.push({
          id: question.id,
          question: question.text,
          answer: ticked ? "Yes" : "No",
          value: ticked,
        });
        break;
      }
      case "choice": {
        const option = question.options.find((each) => each.id === value);
        if (option === undefined && value !== undefined && value !== "") {
          return reject({ _tag: "AnswerUnknown", question: question.text });
        }
        if (option === undefined && question.required) {
          return reject({ _tag: "AnswerMissing", question: question.text });
        }
        if (option !== undefined) {
          stored.push({
            id: question.id,
            question: question.text,
            answer: option.text,
            value: option.id,
          });
        }
        break;
      }
    }
  }
  return Effect.succeed(stored);
};
