import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import type { Problem, PublishField } from "../api/Problems.ts";
import { Cover, Question, Tag, ZonedDateTime } from "../Model.ts";

// Content types are safe to share with the editor. A draft must always match
// its type's schema exactly: changes that would add unknown fields or change
// a field's type are rejected before they are stored.

/** A whole number of attendees, at least one; it fits a Postgres integer. */
const AttendeeLimit = Schema.Int.check(
  Schema.makeFilter(
    (limit: number) =>
      (limit >= 1 && limit <= 2_147_483_647) ||
      "Expected a whole number of at least 1",
  ),
);

/** How often a recurring event comes back: 1 to 7 of its unit. */
const RepeatEvery = Schema.Int.check(
  Schema.makeFilter(
    (every: number) =>
      (every >= 1 && every <= 7) || "Expected a whole number from 1 to 7",
  ),
);
export const RepeatUnit = Schema.Literals(["day", "week", "month", "year"]);
export type RepeatUnit = typeof RepeatUnit.Type;

/** Whether those signed up are reminded: by guests, always or never. */
export const ReminderChoice = Schema.Literals(["default", "on", "off"]);
export type ReminderChoice = typeof ReminderChoice.Type;

/** A draft's reminder choice, older drafts' true and false included. */
export const reminderChoice = (value: unknown): ReminderChoice =>
  value === undefined || value === true
    ? "default"
    : value === false
      ? "off"
      : (String(value) as ReminderChoice); // the studio holds an ImmutableString

export const EventContent = Schema.Struct({
  title: Schema.String,
  /**
   * What the event is, in a sentence or two, under its title and when a link
   * to it is shared. Missing in drafts from before events had a summary.
   */
  summary: Schema.optionalKey(Schema.String),
  body: Schema.String,
  /**
   * Missing when there is none. `src` is an ImmutableString, replaced as a
   * whole; `alt` is text, edited together.
   */
  cover: Schema.optionalKey(Cover),
  // The times are Automerge ImmutableStrings, replaced as a whole rather
  // than merged character by character. Null until picked.
  start: Schema.NullOr(ZonedDateTime),
  end: Schema.NullOr(ZonedDateTime),
  /** When signing up and cancelling close. Null: when the event starts. */
  deadline: Schema.NullOr(ZonedDateTime),
  /** Visible without logging in. Otherwise only signed-in users see it. */
  public: Schema.Boolean,
  /**
   * People without an account can sign up with a name and email. Only takes
   * effect for public events.
   */
  guests: Schema.Boolean,
  /**
   * Food is served: everyone signing up, members and guests, may say what
   * they can't eat, until the food deadline.
   */
  dietary: Schema.Boolean,
  /** What or where people eat, e.g. "Pizza from Lorem". */
  food: Schema.String,
  /** Dietary preferences are asked until then; null: until sign-up closes. */
  foodDeadline: Schema.NullOr(ZonedDateTime),
  /** Asked of everyone signing up. */
  questions: Schema.Array(Question),
  /**
   * What the event is about, to find it by. Two people adding the same tag
   * at once leaves it twice: it counts once, ignoring case.
   */
  tags: Schema.Array(Tag),
  /**
   * Whether everyone signed up is reminded by email the morning before:
   * "default" for events guests can sign up for, "on" or "off" for any
   * event. An ImmutableString. Missing, or true, in drafts from before
   * there was a choice: "default"; false: "off".
   */
  reminders: Schema.optionalKey(Schema.Union([ReminderChoice, Schema.Boolean])),
  /**
   * Where it is, as written: "Kantina, 2. etasje". Missing in drafts from
   * before events had a place.
   */
  place: Schema.optionalKey(Schema.String),
  /**
   * The most who can sign up, members and guests together. Missing: no
   * limit. Set below those signed up, it keeps them all and takes nobody
   * new until enough have cancelled.
   */
  maxAttendees: Schema.optionalKey(AttendeeLimit),
  /** Don't show how many places are left. Missing: shown. */
  hidePlacesLeft: Schema.optionalKey(Schema.Boolean),
  /**
   * Streamed: those signing up say whether they come in person or follow
   * online, and only those in person count against the limit. Missing: no.
   */
  streamed: Schema.optionalKey(Schema.Boolean),
  /** Where it is streamed, as written; published only while streamed. */
  streamLink: Schema.optionalKey(Schema.String),
  /**
   * Sent to HubSpot as a Marketing Event, with its sign-ups. Only for a
   * public event open to guests. Missing: no.
   */
  salesEvent: Schema.optionalKey(Schema.Boolean),
  /** The Marketing Event's type, as written. Missing or blank: «Frokostseminar». */
  salesEventType: Schema.optionalKey(Schema.String),
  /**
   * The emails' own subject and text, per email: written for every recipient
   * as is. Missing or blank: the standard, in each recipient's language.
   * Texts are rich text, as the body.
   */
  signedUpSubject: Schema.optionalKey(Schema.String),
  signedUpText: Schema.optionalKey(Schema.String),
  signupCancelledSubject: Schema.optionalKey(Schema.String),
  signupCancelledText: Schema.optionalKey(Schema.String),
  eventChangedSubject: Schema.optionalKey(Schema.String),
  eventChangedText: Schema.optionalKey(Schema.String),
  eventCancelledSubject: Schema.optionalKey(Schema.String),
  eventCancelledText: Schema.optionalKey(Schema.String),
  /**
   * When it has ended, it moves on to its next date and is published again,
   * without those signed up (see Recurring.ts). Missing: no.
   */
  recurring: Schema.optionalKey(Schema.Boolean),
  /** How many units apart its dates are. Missing: 1. */
  repeatEvery: Schema.optionalKey(RepeatEvery),
  /** An ImmutableString, replaced as a whole. Missing: "week". */
  repeatUnit: Schema.optionalKey(RepeatUnit),
});
export type EventContent = typeof EventContent.Type;

/** When signing up and cancelling close: the deadline, or else the start. */
export function signupClosesAt<Time>(
  deadline: Time | null,
  startsAt: Time,
): Time;
export function signupClosesAt<Time>(
  deadline: Time | null,
  startsAt: Time | null,
): Time | null;
export function signupClosesAt<Time>(
  deadline: Time | null,
  startsAt: Time | null,
): Time | null {
  return deadline ?? startsAt;
}

/** When dietary questions close: their deadline, or else sign-up close. */
export function dietaryClosesAt<Time>(
  foodDeadline: Time | null,
  signupDeadline: Time | null,
  startsAt: Time,
): Time;
export function dietaryClosesAt<Time>(
  foodDeadline: Time | null,
  signupDeadline: Time | null,
  startsAt: Time | null,
): Time | null;
export function dietaryClosesAt<Time>(
  foodDeadline: Time | null,
  signupDeadline: Time | null,
  startsAt: Time | null,
): Time | null {
  return foodDeadline ?? signupClosesAt(signupDeadline, startsAt);
}

/** An http or https address. */
const isWebAddress = (text: string) => {
  try {
    return ["http:", "https:"].includes(new URL(text).protocol);
  } catch {
    return false;
  }
};

/** What a draft needs before it can be published, named for messages. */
export interface Requirement<Content> {
  readonly field: PublishField;
  readonly met: (content: Content) => boolean;
}

export const contentTypes = {
  event: {
    schema: EventContent,
    initial: {
      title: "",
      summary: "",
      body: "",
      start: null,
      end: null,
      deadline: null,
      public: false,
      guests: false,
      dietary: false,
      food: "",
      foodDeadline: null,
      questions: [],
      tags: [],
      place: "",
    } satisfies EventContent,
    toPublish: [
      { field: "title", met: (event) => event.title.trim() !== "" },
      { field: "start", met: (event) => event.start !== null },
      { field: "end", met: (event) => event.end !== null },
      { field: "place", met: (event) => (event.place ?? "").trim() !== "" },
    ] satisfies ReadonlyArray<Requirement<EventContent>>,
    checks: [
      (event) =>
        event.start !== null &&
        event.end !== null &&
        compare(event.end, event.start) <= 0
          ? { _tag: "EndsBeforeStart" }
          : null,
      (event) =>
        event.start !== null &&
        event.deadline !== null &&
        compare(event.deadline, event.start) > 0
          ? { _tag: "DeadlineAfterStart" }
          : null,
      (event) => {
        const closes = signupClosesAt(event.deadline, event.start);
        return event.foodDeadline !== null &&
          closes !== null &&
          compare(event.foodDeadline, closes) > 0
          ? { _tag: "FoodDeadlineAfterClose" }
          : null;
      },
      (event) =>
        event.questions.some((question) => question.text.trim() === "")
          ? { _tag: "QuestionWithoutText" }
          : null,
      (event) =>
        event.questions.some(
          (question) =>
            question.type === "choice" &&
            (question.options.length < 2 ||
              question.options.some((option) => option.text.trim() === "")),
        )
          ? { _tag: "ChoiceWithoutOptions" }
          : null,
      (event) =>
        new Set(
          [event.start, event.end, event.deadline, event.foodDeadline]
            .filter((time) => time !== null)
            .map((time) => Temporal.ZonedDateTime.from(time).timeZoneId),
        ).size > 1
          ? { _tag: "MixedTimeZones" }
          : null,
      (event) => {
        const link = (event.streamLink ?? "").trim();
        return event.streamed === true && link !== "" && !isWebAddress(link)
          ? { _tag: "StreamLinkNotWeb" }
          : null;
      },
    ] satisfies ReadonlyArray<Check<EventContent>>,
  },
};

/** Something else that must hold to publish: why not, or null. */
export type Check<Content> = (content: Content) => Problem | null;

const compare = (a: ZonedDateTime, b: ZonedDateTime) =>
  Temporal.ZonedDateTime.compare(
    Temporal.ZonedDateTime.from(a),
    Temporal.ZonedDateTime.from(b),
  );

/**
 * Why the content can't be published yet: "Add a title and a start time
 * before publishing", or a failed check. Null when it can be.
 */
export const cantPublish = <Content>(
  type: {
    readonly toPublish: ReadonlyArray<Requirement<Content>>;
    readonly checks: ReadonlyArray<Check<Content>>;
  },
  content: Content,
): Problem | null =>
  missingToPublish(type.toPublish, content) ??
  type.checks.map((check) => check(content)).find((why) => why !== null) ??
  null;

/** What's missing to publish ("Add a title and a start time"), or null. */
export const missingToPublish = <Content>(
  requirements: ReadonlyArray<Requirement<Content>>,
  content: Content,
): Problem | null => {
  const [first, ...rest] = requirements
    .filter((requirement) => !requirement.met(content))
    .map((requirement) => requirement.field);
  return first === undefined
    ? null
    : { _tag: "MissingToPublish", fields: [first, ...rest] };
};

export type ContentTypeName = keyof typeof contentTypes;
export const ContentTypeName = Schema.Literals(
  Object.keys(contentTypes) as Array<ContentTypeName>,
);
