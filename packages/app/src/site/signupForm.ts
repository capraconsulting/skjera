import { type Answers, Problem, type Question } from "@skjera/documents/api";
import { Option, Schema } from "effect";

/** A guest's inputs, by the `name` they carry (the names HubSpot reads). */
export type GuestField = "firstname" | "email" | "telephone" | "company";

/**
 * The option a choice question starts on: the one answered before, if it is
 * still offered, else the first.
 */
export const chosenOption = (
  question: Pick<Question, "id" | "options">,
  given: Answers | undefined,
): string | undefined => {
  const before = given?.[question.id];
  const offered = question.options.find((option) => option.id === before);
  return (offered ?? question.options[0])?.id;
};

/**
 * A checkbox question's words: its text above the box and its label beside
 * it, or, with no label or a blank one, its text beside the box.
 */
export const checkboxWords = (
  question: Pick<Question, "text" | "label">,
): { readonly above: string | undefined; readonly beside: string } => {
  const label = (question.label ?? "").trim();
  return label === ""
    ? { above: undefined, beside: question.text }
    : { above: question.text, beside: label };
};

const decodeProblem = Schema.decodeUnknownOption(Problem);

/**
 * The guest input a refusal belongs to; none for a problem that is not
 * about one, or for anything that is not a problem.
 */
export const fieldOf = (problem: unknown): GuestField | undefined => {
  const decoded = decodeProblem(problem);
  if (Option.isNone(decoded)) return undefined;
  switch (decoded.value._tag) {
    case "GuestNameTooShort":
      return "firstname";
    case "MemberEmail":
      return "email";
    case "GuestPhoneInvalid":
      return "telephone";
    case "GuestCompanyTooShort":
      return "company";
    default:
      return undefined;
  }
};
