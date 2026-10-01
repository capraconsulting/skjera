import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import { Cover, ZonedDateTime } from "./Model.ts";

// Content types are safe to share with the editor. A draft must always match
// its type's schema exactly: changes that would add unknown fields or change
// a field's type are rejected before they are stored.

export const EventContent = Schema.Struct({
  title: Schema.String,
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
  /** Everyone signing up, members and guests, must say what they can't eat. */
  dietary: Schema.Boolean,
});
export type EventContent = typeof EventContent.Type;

/** What a draft needs before it can be published, named for messages. */
export interface Requirement<Content> {
  readonly label: string;
  readonly met: (content: Content) => boolean;
}

export const contentTypes = {
  event: {
    schema: EventContent,
    initial: {
      title: "",
      body: "",
      start: null,
      end: null,
      deadline: null,
      public: false,
      guests: false,
      dietary: false,
    } satisfies EventContent,
    toPublish: [
      { label: "a title", met: (event) => event.title.trim() !== "" },
      { label: "a start time", met: (event) => event.start !== null },
      { label: "an end time", met: (event) => event.end !== null },
    ] satisfies ReadonlyArray<Requirement<EventContent>>,
    checks: [
      (event) =>
        event.start !== null &&
        event.end !== null &&
        compare(event.end, event.start) <= 0
          ? "The event has to end after it starts"
          : null,
      (event) =>
        event.start !== null &&
        event.deadline !== null &&
        compare(event.deadline, event.start) > 0
          ? "The sign-up deadline can't be after the event starts"
          : null,
      (event) =>
        new Set(
          [event.start, event.end, event.deadline]
            .filter((time) => time !== null)
            .map((time) => Temporal.ZonedDateTime.from(time).timeZoneId),
        ).size > 1
          ? "The times have to be in the same time zone"
          : null,
    ] satisfies ReadonlyArray<Check<EventContent>>,
  },
};

/** Something else that must hold to publish: why not, or null. */
export type Check<Content> = (content: Content) => string | null;

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
): string | null =>
  missingToPublish(type.toPublish, content) ??
  type.checks.map((check) => check(content)).find((why) => why !== null) ??
  null;

/** "Add a title and a start time before publishing", or null when nothing is missing. */
export const missingToPublish = <Content>(
  requirements: ReadonlyArray<Requirement<Content>>,
  content: Content,
): string | null => {
  const missing = requirements
    .filter((requirement) => !requirement.met(content))
    .map((requirement) => requirement.label);
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
  return `Add ${list} before publishing`;
};

export type ContentTypeName = keyof typeof contentTypes;
export const ContentTypeName = Schema.Literals(
  Object.keys(contentTypes) as Array<ContentTypeName>,
);
