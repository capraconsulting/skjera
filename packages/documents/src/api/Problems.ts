import { m } from "@skjera/i18n/messages";
import { Schema } from "effect";
import type { Locale } from "../Model.ts";

// Why something was refused, as data: errors carry one, and the interface
// says it in the language picked (`describe`). Their `message` says it in
// English, for logs and other clients.

const question = { question: Schema.String };

/** What an event needs before it can be published. */
export const PublishField = Schema.Literals(["title", "start", "end", "place"]);
export type PublishField = typeof PublishField.Type;

export const Problem = Schema.Union([
  // Signing up.
  Schema.TaggedStruct("SignupClosed", {}),
  Schema.TaggedStruct("GuestsNotAllowed", {}),
  Schema.TaggedStruct("EmailTaken", {}),
  Schema.TaggedStruct("EventFull", {}),
  Schema.TaggedStruct("DietaryTooLong", {}),
  Schema.TaggedStruct("AttendanceMissing", {}),
  Schema.TaggedStruct("AnswerTooLong", question),
  Schema.TaggedStruct("AnswerMissing", question),
  Schema.TaggedStruct("TickMissing", question),
  Schema.TaggedStruct("AnswerUnknown", question),
  Schema.TaggedStruct("LogInToAttend", {}),
  Schema.TaggedStruct("LogInOrGuest", {}),
  Schema.TaggedStruct("MemberEmail", {}),
  Schema.TaggedStruct("GuestNameTooShort", {}),
  Schema.TaggedStruct("GuestCompanyTooShort", {}),
  Schema.TaggedStruct("GuestPhoneInvalid", {}),
  Schema.TaggedStruct("FormNotValid", {}),
  Schema.TaggedStruct("TooManyAttempts", {}),
  // Cancelling by email.
  Schema.TaggedStruct("NoSignupForEmail", {}),
  Schema.TaggedStruct("CancelLinkExpired", {}),
  Schema.TaggedStruct("CancelLinkUsed", {}),
  Schema.TaggedStruct("CancelLinkInvalid", {}),
  // Publishing.
  Schema.TaggedStruct("MissingToPublish", {
    fields: Schema.NonEmptyArray(PublishField),
  }),
  Schema.TaggedStruct("EndsBeforeStart", {}),
  Schema.TaggedStruct("DeadlineAfterStart", {}),
  Schema.TaggedStruct("FoodDeadlineAfterClose", {}),
  Schema.TaggedStruct("QuestionWithoutText", {}),
  Schema.TaggedStruct("ChoiceWithoutOptions", {}),
  Schema.TaggedStruct("MixedTimeZones", {}),
  Schema.TaggedStruct("StreamLinkNotWeb", {}),
  Schema.TaggedStruct("UnknownVersion", {}),
  // Teams.
  Schema.TaggedStruct("TeamNameLength", {}),
  Schema.TaggedStruct("TeamNameTaken", { name: Schema.String }),
  Schema.TaggedStruct("TeamNotEmpty", {}),
  // Images.
  Schema.TaggedStruct("ImageTooBig", { maxMb: Schema.Number }),
  Schema.TaggedStruct("ImageFormat", {}),
  // Invitations.
  Schema.TaggedStruct("InvitedEmailInvalid", {}),
  Schema.TaggedStruct("AlreadyInvited", { email: Schema.String }),
  // Emailing those signed up.
  Schema.TaggedStruct("EmailSubjectMissing", {}),
  Schema.TaggedStruct("EmailTextMissing", {}),
  Schema.TaggedStruct("NobodyToEmail", {}),
  // Moving an event to another team.
  Schema.TaggedStruct("OrganizerLocked", {}),
]);
export type Problem = typeof Problem.Type;

const fieldNames: Record<
  PublishField,
  (inputs: object, options: { locale?: Locale }) => string
> = {
  title: m.problem_field_title,
  start: m.problem_field_start,
  end: m.problem_field_end,
  place: m.problem_field_place,
};

/** "a title, a start time and an end time" */
const list = (items: ReadonlyArray<string>, options: { locale?: Locale }) =>
  items.length === 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} ${m.problem_and({}, options)} ${items.at(-1)}`;

/** The problem, said in `locale`; in the interface's when not given. */
export const describe = (problem: Problem, locale?: Locale): string => {
  const options = locale === undefined ? {} : { locale };
  switch (problem._tag) {
    case "SignupClosed":
      return m.problem_signup_closed({}, options);
    case "GuestsNotAllowed":
      return m.problem_guests_not_allowed({}, options);
    case "EmailTaken":
      return m.problem_email_taken({}, options);
    case "EventFull":
      return m.problem_event_full({}, options);
    case "DietaryTooLong":
      return m.problem_dietary_too_long({}, options);
    case "AttendanceMissing":
      return m.problem_attendance_missing({}, options);
    case "AnswerTooLong":
      return m.problem_answer_too_long(problem, options);
    case "AnswerMissing":
      return m.problem_answer_missing(problem, options);
    case "TickMissing":
      return m.problem_tick_missing(problem, options);
    case "AnswerUnknown":
      return m.problem_answer_unknown(problem, options);
    case "LogInToAttend":
      return m.problem_log_in_to_attend({}, options);
    case "LogInOrGuest":
      return m.problem_log_in_or_guest({}, options);
    case "MemberEmail":
      return m.problem_member_email({}, options);
    case "GuestNameTooShort":
      return m.problem_guest_name_too_short({}, options);
    case "GuestCompanyTooShort":
      return m.problem_guest_company_too_short({}, options);
    case "GuestPhoneInvalid":
      return m.problem_guest_phone_invalid({}, options);
    case "FormNotValid":
      return m.problem_form_not_valid({}, options);
    case "TooManyAttempts":
      return m.problem_too_many_attempts({}, options);
    case "NoSignupForEmail":
      return m.problem_no_signup_for_email({}, options);
    case "CancelLinkExpired":
      return m.problem_cancel_link_expired({}, options);
    case "CancelLinkUsed":
      return m.problem_cancel_link_used({}, options);
    case "CancelLinkInvalid":
      return m.problem_cancel_link_invalid({}, options);
    case "MissingToPublish":
      return m.problem_missing_to_publish(
        {
          fields: list(
            problem.fields.map((field) => fieldNames[field]({}, options)),
            options,
          ),
        },
        options,
      );
    case "EndsBeforeStart":
      return m.problem_ends_before_start({}, options);
    case "DeadlineAfterStart":
      return m.problem_deadline_after_start({}, options);
    case "FoodDeadlineAfterClose":
      return m.problem_food_deadline_after_close({}, options);
    case "QuestionWithoutText":
      return m.problem_question_without_text({}, options);
    case "ChoiceWithoutOptions":
      return m.problem_choice_without_options({}, options);
    case "MixedTimeZones":
      return m.problem_mixed_time_zones({}, options);
    case "StreamLinkNotWeb":
      return m.problem_stream_link_not_web({}, options);
    case "UnknownVersion":
      return m.problem_unknown_version({}, options);
    case "TeamNameLength":
      return m.problem_team_name_length({}, options);
    case "TeamNameTaken":
      return m.problem_team_name_taken(problem, options);
    case "TeamNotEmpty":
      return m.studio_only_empty_teams({}, options);
    case "ImageTooBig":
      return m.editor_image_size({ mb: problem.maxMb }, options);
    case "ImageFormat":
      return m.editor_image_type({}, options);
    case "InvitedEmailInvalid":
      return m.problem_invited_email_invalid({}, options);
    case "AlreadyInvited":
      return m.problem_already_invited(problem, options);
    case "EmailSubjectMissing":
      return m.problem_email_subject_missing({}, options);
    case "EmailTextMissing":
      return m.problem_email_text_missing({}, options);
    case "NobodyToEmail":
      return m.problem_nobody_to_email({}, options);
    case "OrganizerLocked":
      return m.studio_organizer_locked({}, options);
  }
};

/** An error's fields for a problem: it, and it said in English. */
export const refused = (problem: Problem) => ({
  problem,
  message: describe(problem, "en"),
});
