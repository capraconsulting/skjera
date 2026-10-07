import { describe, Problem } from "@skjera/documents/api";
import { Option, Schema } from "effect";

const decodeProblem = Schema.decodeUnknownOption(Problem);

/**
 * Why the server refused, in the interface's language: from the refusal's
 * problem, else its message (in English), else `fallback`.
 */
export const sayWhy = (failure: unknown, fallback: string): string => {
  if (typeof failure !== "object" || failure === null) return fallback;
  if ("problem" in failure) {
    const problem = decodeProblem(failure.problem);
    if (Option.isSome(problem)) return describe(problem.value);
  }
  return "message" in failure && typeof failure.message === "string"
    ? failure.message
    : fallback;
};
