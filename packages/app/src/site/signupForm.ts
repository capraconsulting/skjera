import {
  type AdSource,
  type Answers,
  type Locale,
  Problem,
  type Question,
  type ShownEvent,
} from "@skjera/documents/api";
import { Option, Schema } from "effect";
import type { Signup, SignupChange } from "../sync/tables.ts";

/** A guest's inputs, by the `name` they carry (the names HubSpot reads). */
export type GuestField =
  | "firstname"
  | "email"
  | "telephone"
  | "company"
  | "jobtitle";

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

/** The name a question's input carries in the sign-up and change forms. */
export const questionField = (question: Pick<Question, "id">) =>
  `question-${question.id}`;

/** The answers in a form, by question id: a checkbox is always answered. */
const answersFrom = (
  questions: ReadonlyArray<Question>,
  form: FormData,
): Answers => {
  const answers: Record<string, string | boolean> = {};
  for (const question of questions) {
    const value = form.get(questionField(question));
    if (question.type === "checkbox") answers[question.id] = value !== null;
    else if (value !== null) answers[question.id] = String(value);
  }
  return answers;
};

/** Online or in person; undefined while the event is not streamed. */
const onlineFrom = (event: Pick<ShownEvent, "isStreamed">, form: FormData) =>
  event.isStreamed ? form.get("attendance") === "online" : undefined;

/** The name of the box that asks for invitations and the newsletter. */
export const consentField = "consent";

/** A text field of the form as written; empty when it is not there. */
const textOf = (form: FormData, name: string) => String(form.get(name) ?? "");

/**
 * What a sign-up form carries for the event: whether a guest's form asks for
 * a job title, whether the form asks for invitations and the newsletter, and
 * its attributes. A sales event's form is kept out of the forms HubSpot's
 * script collects, as the sign-up is sent to HubSpot with the event.
 */
export const salesEventForm = (event: Pick<ShownEvent, "isSalesEvent">) =>
  event.isSalesEvent
    ? {
        askJobTitle: true,
        askConsent: true,
        formAttributes: { "data-hs-do-not-collect": "true" } as Record<
          string,
          string
        >,
      }
    : {
        askJobTitle: false,
        askConsent: false,
        formAttributes: {} as Record<string, string>,
      };

/** What a sign-up form sends, each field read once. */
export const signupFrom = (
  event: Pick<ShownEvent, "questions" | "isStreamed" | "isSalesEvent">,
  form: FormData,
  asGuest: boolean,
  locale: Locale,
  source?: AdSource,
): Signup => {
  const dietary = form.get("dietary");
  const online = onlineFrom(event, form);
  return {
    // Emails to them are in it.
    locale,
    ...(dietary === null ? {} : { dietary: String(dietary) }),
    answers: answersFrom(event.questions, form),
    ...(online === undefined ? {} : { online }),
    ...(source === undefined ? {} : { source }),
    ...(salesEventForm(event).askConsent && form.get(consentField) !== null
      ? { consent: true }
      : {}),
    ...(asGuest
      ? {
          guest: {
            name: textOf(form, "firstname"),
            email: textOf(form, "email"),
            phone: textOf(form, "telephone"),
            company: textOf(form, "company"),
            ...(salesEventForm(event).askJobTitle
              ? { jobTitle: textOf(form, "jobtitle") }
              : {}),
          },
          honeypot: textOf(form, "subject"),
        }
      : {}),
  };
};

/**
 * What a change form sends. Only a guest's form has phone and company;
 * empty clears.
 */
export const changeFrom = (
  event: Pick<ShownEvent, "questions" | "isStreamed">,
  form: FormData,
  asGuest: boolean,
): SignupChange => {
  const online = onlineFrom(event, form);
  return {
    answers: answersFrom(event.questions, form),
    ...(online === undefined ? {} : { online }),
    ...(asGuest
      ? {
          phone: textOf(form, "telephone"),
          company: textOf(form, "company"),
        }
      : {}),
  };
};
