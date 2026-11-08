import { Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import type { Problem } from "./api/Problems.ts";

export * from "./CoverModel.ts";
export * from "./SiteModel.ts";

import { ImageSrc } from "./CoverModel.ts";

// Document identity and publish state, shared by the server and the editor.

/** A UUID; clients may pick it when creating a document. */
export const DocumentId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("DocumentId"),
);
export type DocumentId = typeof DocumentId.Type;

/**
 * A moment as the time on the clock in a time zone, with the zone's offset
 * then: "2026-10-15T18:00+02:00[Europe/Oslo]" (RFC 9557, as Temporal
 * writes it). The offset has to be the zone's at that time, so the value
 * reads the same with or without time zone rules.
 */
export const ZonedDateTime = Schema.String.check(
  Schema.makeFilter((value: string) => {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}\[[A-Za-z0-9_/+-]+\]$/.test(
        value,
      )
    ) {
      return "Expected a time like 2026-10-15T18:00+02:00[Europe/Oslo]";
    }
    try {
      // Rejects unknown zones, impossible times, and offsets the zone
      // doesn't have then.
      Temporal.ZonedDateTime.from(value, { offset: "reject" });
      return true;
    } catch {
      return "Expected a time that exists in its time zone";
    }
  }),
);
export type ZonedDateTime = typeof ZonedDateTime.Type;

/** A UUID; clients may pick it when creating a team. */
export const TeamId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("TeamId"),
);
export type TeamId = typeof TeamId.Type;

/** A team's logos: uploaded images for the light theme and the dark; null: none. */
export const TeamLogos = Schema.Struct({
  logo: Schema.NullOr(ImageSrc),
  logoDark: Schema.NullOr(ImageSrc),
});
export type TeamLogos = typeof TeamLogos.Type;

/** Changing a team's logos: each one given is set, or removed with null. */
export const TeamLogosChange = Schema.Struct({
  logo: Schema.optionalKey(Schema.NullOr(ImageSrc)),
  logoDark: Schema.optionalKey(Schema.NullOr(ImageSrc)),
});
export type TeamLogosChange = typeof TeamLogosChange.Type;

export class Team extends Schema.Class<Team>("@skjera/documents/Team")({
  id: TeamId,
  name: Schema.String,
  ...TeamLogos.fields,
  createdAt: Schema.Date,
  /** How many documents the team has; only empty teams can be deleted. */
  documentCount: Schema.Int,
}) {}

/** Hex change hashes identifying a version of a document. */
export const Heads = Schema.Array(Schema.String);
export type Heads = typeof Heads.Type;

/**
 * A version of a document that can be named: one or more change hashes, each
 * 64 lower-case hexadecimal characters. `Heads` is any array of strings.
 */
export const Version = Schema.NonEmptyArray(
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
);
export type Version = typeof Version.Type;
export const isVersion = Schema.is(Version);

export class Publication extends Schema.Class<Publication>(
  "@skjera/documents/Publication",
)({
  /** The version of the draft that was published. */
  heads: Heads,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}

export class PublishingNotice extends Schema.Class<PublishingNotice>(
  "@skjera/documents/PublishingNotice",
)({
  moved: Schema.Boolean,
  newPlace: Schema.Boolean,
  told: Schema.Int,
}) {}

export class CancellingNotice extends Schema.Class<CancellingNotice>(
  "@skjera/documents/CancellingNotice",
)({ told: Schema.Int }) {}

export class NoticeChanged extends Schema.TaggedClass<NoticeChanged>()(
  "NoticeChanged",
  { notice: Schema.Union([PublishingNotice, CancellingNotice]) },
) {}

/** One line of an event's history: what happened, by whom, and the version it left. */
export class HistoryEntry extends Schema.Class<HistoryEntry>(
  "@skjera/documents/HistoryEntry",
)({
  kind: Schema.Literals(["edited", "published", "restored", "discarded"]),
  at: Schema.Date,
  /** The draft as it was after this entry, or the version published. */
  heads: Heads,
  /** The person's name, or their email; null when Skjera has neither. */
  by: Schema.NullOr(Schema.String),
  /** Skjera did it on its own: the move of a recurring event to its next date. */
  automatic: Schema.Boolean,
}) {}

/**
 * Who is looking: anyone sees public events, signed-in users see all
 * published events.
 */
export type Audience = "anyone" | "members";

export const cancelLinkHours = 2;
export const signupRetentionDays = 30;
export const defaultEventType = "Frokostseminar";

export const guestPhoneLength = 50;
export const GuestPhone = Schema.String.check(
  Schema.isMaxLength(guestPhoneLength),
);

/**
 * A mobile number: Norwegian (eight digits from 4 or 9, with +47 or 0047 or
 * without), or another country's, with + or 00 and its code. Spaces, dashes,
 * dots and brackets don't count. Another country's is checked for its form
 * only: telling its mobiles from its landlines needs its number ranges.
 */
export const isMobileNumber = (phone: string): boolean => {
  const digits = phone.replace(/[\s().-]/g, "");
  return (
    /^(?:\+47|0047)?[49]\d{7}$/.test(digits) ||
    /^(?:\+|00)(?!47)[1-9]\d{7,14}$/.test(digits)
  );
};

/** Why a guest's details are refused, field by field. */
export type GuestProblem = Extract<
  Problem,
  {
    _tag: "GuestNameTooShort" | "GuestCompanyTooShort" | "GuestPhoneInvalid";
  }
>;

/**
 * What is wrong with a guest's details, field by field. Checks only the
 * fields it is given (a change sends no name); a blank phone number or
 * company counts as not given.
 */
export const guestProblems = (guest: {
  readonly name?: string;
  readonly phone?: string;
  readonly company?: string;
}): ReadonlyArray<GuestProblem> => {
  const problems: Array<GuestProblem> = [];
  if (guest.name !== undefined && guest.name.trim().length < 2) {
    problems.push({ _tag: "GuestNameTooShort" });
  }
  const company = guest.company?.trim() ?? "";
  if (company !== "" && company.length < 2) {
    problems.push({ _tag: "GuestCompanyTooShort" });
  }
  const phone = guest.phone?.trim() ?? "";
  if (phone !== "" && !isMobileNumber(phone)) {
    problems.push({ _tag: "GuestPhoneInvalid" });
  }
  return problems;
};
/** The company a guest comes from. */
export const guestCompanyLength = 100;
export const GuestCompany = Schema.String.check(
  Schema.isMaxLength(guestCompanyLength),
);
/** An address forms take: something@something.something, at most 254 characters, once trimmed. */
export const isEmailAddress = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
/** A guest's job title on a sales event's form. */
export const guestJobTitleLength = 100;
export const GuestJobTitle = Schema.String.check(
  Schema.isMaxLength(guestJobTitleLength),
);
/** The names of the address's values that say which ad someone came from. */
export const adSourceKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "li_fat_id",
  "fbclid",
] as const;
export type AdSourceKey = (typeof adSourceKeys)[number];

/** The longest value kept: the browser cuts to it, the server refuses more. */
export const adSourceValueLength = 500;
const AdSourceValue = Schema.String.check(
  Schema.isMaxLength(adSourceValueLength),
);
/** The ad a sign-up came from: the values the address had, by name. */
export const AdSource = Schema.Struct({
  utm_source: Schema.optionalKey(AdSourceValue),
  utm_medium: Schema.optionalKey(AdSourceValue),
  utm_campaign: Schema.optionalKey(AdSourceValue),
  utm_content: Schema.optionalKey(AdSourceValue),
  utm_term: Schema.optionalKey(AdSourceValue),
  li_fat_id: Schema.optionalKey(AdSourceValue),
  fbclid: Schema.optionalKey(AdSourceValue),
});
export type AdSource = typeof AdSource.Type;

export const GuestDetails = Schema.Struct({
  name: Schema.String.check(
    Schema.makeFilter(
      (name: string) =>
        (name.trim() !== "" && name.trim().length <= 100) ||
        "Enter your name (at most 100 characters)",
    ),
  ),
  email: Schema.String.check(
    Schema.makeFilter(
      (email: string) => isEmailAddress(email) || "Enter a valid email address",
    ),
  ),
  phone: Schema.optionalKey(GuestPhone),
  company: Schema.optionalKey(GuestCompany),
  jobTitle: Schema.optionalKey(GuestJobTitle),
});
export type GuestDetails = typeof GuestDetails.Type;

/** A tag on an event, e.g. "Workshop": trimmed, at most 40 characters. */
export const tagLength = 40;
export const Tag = Schema.String.check(
  Schema.makeFilter(
    (tag: string) =>
      (tag.trim() === tag && tag !== "" && tag.length <= tagLength) ||
      "Expected a tag of 1 to 40 characters, without spaces around it",
  ),
);
export const dietaryPreferenceLength = 500;
export const writtenAnswerLength = 1000;
export const teamNameLength = 100;
export type Tag = typeof Tag.Type;

export const sameTag = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/** Tags without repeats, ignoring case: each as first written. */
export const uniqueTags = (
  tags: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    if ([...seen].some((kept) => sameTag(kept, tag))) return false;
    seen.add(tag);
    return true;
  });
};

/**
 * A question asked of everyone signing up. "text" takes a written answer,
 * "checkbox" a tick (the text is the words beside the box, e.g. "I'll bring
 * a friend", unless it has a label), and "choice" one of its options. Ids
 * keep answers to the question they were given for, whatever is edited.
 */
export const Question = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  type: Schema.Literals(["text", "checkbox", "choice"]),
  text: Schema.String,
  /**
   * Checkbox: the words beside the box, with the text above it as the
   * question. Missing or blank: the text is beside the box.
   */
  label: Schema.optionalKey(Schema.String),
  /** Text and choice: an answer is needed. Checkbox: it must be ticked. */
  required: Schema.Boolean,
  /** For choice questions; empty for the others. */
  options: Schema.Array(
    Schema.Struct({
      id: Schema.String.check(Schema.isUUID()),
      text: Schema.String,
    }),
  ),
});
export type Question = typeof Question.Type;

/**
 * Answers given when signing up, by question id: text for text questions,
 * true or false for checkboxes, and the option's id for choices.
 */
export const Answers = Schema.Record(
  Schema.String,
  Schema.Union([Schema.String, Schema.Boolean]),
);
export type Answers = typeof Answers.Type;

/**
 * An answer as stored with the signup: in the words asked and picked then,
 * and as given (`value`, as in `Answers`), to change it later.
 */
export const Answer = Schema.Struct({
  /** The question's id. */
  id: Schema.String,
  question: Schema.String,
  answer: Schema.String,
  value: Schema.Union([Schema.String, Schema.Boolean]),
});
export type Answer = typeof Answer.Type;

export class GuestSignup extends Schema.Class<GuestSignup>(
  "@skjera/documents/GuestSignup",
)({
  /** Cancels this signup. Shown once; only a hash is stored. */
  cancelToken: Schema.String,
}) {}

/**
 * Rich text, as Automerge's `spans()` and pg_automerge's `automerge_spans`
 * give it: runs of text with their marks (bold, links, ...), and blocks
 * (paragraphs, headings, list items, images) that start the text after
 * them.
 */
export const RichText = Schema.Array(
  Schema.Union([
    Schema.Struct({
      type: Schema.Literal("text"),
      value: Schema.String,
      marks: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
    }),
    Schema.Struct({
      type: Schema.Literal("block"),
      value: Schema.Record(Schema.String, Schema.Unknown),
    }),
  ]),
);
export type RichText = typeof RichText.Type;

/** Who organizes an event, as the site shows it: its team. */
export const Organizer = Schema.Struct({
  name: Schema.String,
  ...TeamLogos.fields,
});
export type Organizer = typeof Organizer.Type;

/**
 * The image each theme shows for an organizer; null: its name instead. The
 * dark theme takes the light logo when there's no dark one; the light theme
 * never takes the dark one, made for a dark background.
 */
export const organizerLogos = (logos: TeamLogos) => ({
  light: logos.logo,
  dark: logos.logoDark ?? logos.logo,
});

// Presence: who has a draft open, and their selection. Shared as automerge-
// repo presence, in ephemeral messages (see DraftSync.ts); never stored.

/** A selection in one field, as Automerge cursors that survive edits. */
export const PresenceSelection = Schema.Struct({
  field: Schema.String,
  anchor: Schema.String,
  head: Schema.String,
});
export type PresenceSelection = typeof PresenceSelection.Type;

/** Who an editor is. The server sets it, whatever the editor sends. */
export const PresenceUser = Schema.Struct({
  issuer: Schema.String,
  subject: Schema.String,
  name: Schema.String,
});
export type PresenceUser = typeof PresenceUser.Type;

/** What an editor shares about itself on a draft it has open. */
export type DraftPresenceState = {
  readonly user: PresenceUser | null;
  readonly selection: PresenceSelection | null;
};
