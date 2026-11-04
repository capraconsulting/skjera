import { baseLocale, locales } from "@skjera/i18n/runtime";
import { Config, Option, Schema } from "effect";
import { Temporal } from "temporal-polyfill";
import type { Problem } from "./api/Problems.ts";

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

/** Where an uploaded image is served (see ImagesApi.ts). */
export const ImageSrc = Schema.String.check(
  Schema.isPattern(/^\/api\/images\/[A-Za-z0-9_-]{22}$/),
);

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

export class Publication extends Schema.Class<Publication>(
  "@skjera/documents/Publication",
)({
  /** The version of the draft that was published. */
  heads: Heads,
  publishedAt: Schema.Date,
  firstPublishedAt: Schema.Date,
}) {}

/**
 * Who is looking: anyone sees public events, signed-in users see all
 * published events.
 */
export type Audience = "anyone" | "members";

/** Signing up for an event without an account. */
/** A language the interface and emails are in: "en", "nb" or "nn". */
export const Locale = Schema.Literals(locales);
export type Locale = typeof Locale.Type;

/** The site's language, for those who didn't pick one: `SITE_LOCALE`. */
export const SiteLocale = Config.Literals(locales, "SITE_LOCALE").pipe(
  Config.withDefault(baseLocale),
);

/** An image in a light and, optionally, a dark version: URLs. */
const Picture = Schema.Struct({
  src: Schema.String,
  darkSrc: Schema.optionalKey(Schema.String),
});

/**
 * A text in the footer: the same in every language, or one per language,
 * with Bokmål shown where the page's language has none.
 */
export const FooterText = Schema.Union([
  Schema.String,
  Schema.Struct({
    nb: Schema.String,
    nn: Schema.optionalKey(Schema.String),
    en: Schema.optionalKey(Schema.String),
  }),
]);
export type FooterText = typeof FooterText.Type;

/** A logo in a group: its description, its image(s), and a link or none. */
export const FooterLogo = Schema.Struct({
  label: FooterText,
  ...Picture.fields,
  href: Schema.optionalKey(Schema.String),
});

/** Logos side by side, under a title or none. */
export const FooterGroup = Schema.Struct({
  title: Schema.optionalKey(FooterText),
  logos: Schema.Array(FooterLogo),
});

/** A link in the footer: words, or a logo (with them as its description). */
export const FooterLink = Schema.Struct({
  label: FooterText,
  href: Schema.String,
  logo: Schema.optionalKey(Picture),
});

/**
 * The footer, from `SITE_FOOTER` (JSON): a heading, groups of logos, links,
 * and a line of text where `{year}` is the year.
 */
export const SiteFooter = Schema.Struct({
  heading: Schema.optionalKey(FooterText),
  groups: Schema.optionalKey(Schema.Array(FooterGroup)),
  links: Schema.optionalKey(Schema.Array(FooterLink)),
  text: Schema.optionalKey(FooterText),
});
export type SiteFooter = typeof SiteFooter.Type;

/**
 * Who answers for the personal data kept (`SITE_OPERATOR`, else the site's
 * name), their organisation number (`SITE_OPERATOR_ORG_NUMBER`) and address
 * (`SITE_OPERATOR_ADDRESS`, one line) and how to reach them
 * (`SITE_CONTACT_EMAIL`), for the privacy page; or a policy elsewhere
 * (`SITE_PRIVACY_URL`), linked instead.
 */
export const SitePrivacy = Schema.Struct({
  operator: Schema.String,
  orgNumber: Schema.optionalKey(Schema.String),
  address: Schema.optionalKey(Schema.String),
  contact: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
});

/**
 * The site as the app shows it, from configuration: what it's called
 * (`SITE_NAME`), its language, footer and privacy: `/api/site`.
 */
export const Site = Schema.Struct({
  name: Schema.String,
  locale: Locale,
  footer: Schema.optionalKey(SiteFooter),
  privacy: SitePrivacy,
  /** HubSpot's account, where the site loads HubSpot: `HUBSPOT_ACCOUNT_ID`. */
  hubSpot: Schema.optionalKey(Schema.String),
  /** Emails are sent; absent, as before `/api/site` answers, reads as sent. */
  sendsEmail: Schema.optionalKey(Schema.Boolean),
});
export type Site = typeof Site.Type;

/** Skjer's categories. */
export const categories = ["Sosialt", "Fag"] as const;
export type Category = (typeof categories)[number];

/** An event's category: its first tag named «Sosialt» or «Fag», ignoring case; else none. */
export const eventCategory = (tags: ReadonlyArray<string>): Category | null => {
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    const category = categories.find((name) => name.toLowerCase() === lower);
    if (category !== undefined) return category;
  }
  return null;
};

/** `HUBSPOT_ACCOUNT_ID`: a HubSpot account id, as HubSpot shows it (digits), or blank for none. */
const HubSpotAccountIdText = Schema.String.check(
  Schema.makeFilter(
    (text: string) =>
      /^\d*$/.test(text.trim()) ||
      `Expected a HubSpot account id, digits only; got ${JSON.stringify(text)}`,
  ),
);

/**
 * An optional setting: not there, or blank (empty or only spaces), is not
 * set (`undefined`); else it's read with `read`.
 */
export const optionalSetting = <A>(
  name: string,
  read: (name: string) => Config.Config<A>,
) =>
  Config.option(Config.String(name)).pipe(
    Config.flatMap((text) =>
      Option.isNone(text) || text.value.trim() === ""
        ? Config.succeed<A | undefined>(undefined)
        : read(name),
    ),
  );

/** Only what's there: no keys for what isn't. */
const defined = <A extends object>(fields: A) =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as { [K in keyof A]: Exclude<A[K], undefined> };

export const SiteConfig = Config.all({
  name: Config.String("SITE_NAME").pipe(Config.withDefault("Skjera")),
  locale: SiteLocale,
  footer: optionalSetting("SITE_FOOTER", (name) =>
    Config.schema(Schema.fromJsonString(SiteFooter), name),
  ),
  operator: optionalSetting("SITE_OPERATOR", Config.String),
  orgNumber: optionalSetting("SITE_OPERATOR_ORG_NUMBER", Config.String),
  address: optionalSetting("SITE_OPERATOR_ADDRESS", Config.String),
  contact: optionalSetting("SITE_CONTACT_EMAIL", Config.String),
  privacyUrl: optionalSetting("SITE_PRIVACY_URL", Config.String),
  hubSpot: Config.schema(HubSpotAccountIdText, "HUBSPOT_ACCOUNT_ID").pipe(
    Config.withDefault(""),
  ),
}).pipe(
  Config.map(
    (config): Site => ({
      name: config.name,
      locale: config.locale,
      ...(config.footer === undefined ? {} : { footer: config.footer }),
      privacy: defined({
        operator: config.operator ?? config.name,
        orgNumber: config.orgNumber,
        address: config.address,
        contact: config.contact,
        url: config.privacyUrl,
      }),
      ...(config.hubSpot.trim() === ""
        ? {}
        : { hubSpot: config.hubSpot.trim() }),
    }),
  ),
);
/** A guest's phone number, as typed, at most 50 characters; `guestProblems` checks the rest. */
export const GuestPhone = Schema.String.check(Schema.isMaxLength(50));

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
export const GuestCompany = Schema.String.check(Schema.isMaxLength(100));
/** An address forms take: something@something.something, at most 254 characters, once trimmed. */
export const isEmailAddress = (email: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254;
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
});
export type GuestDetails = typeof GuestDetails.Type;

/** A tag on an event, e.g. "Workshop": trimmed, at most 40 characters. */
export const Tag = Schema.String.check(
  Schema.makeFilter(
    (tag: string) =>
      (tag.trim() === tag && tag !== "" && tag.length <= 40) ||
      "Expected a tag of 1 to 40 characters, without spaces around it",
  ),
);
export type Tag = typeof Tag.Type;

/** Tags without repeats, ignoring case: each as first written. */
export const uniqueTags = (
  tags: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/**
 * A question asked of everyone signing up. "text" takes a written answer,
 * "checkbox" a tick (the text is its label, e.g. "I'll bring a friend"),
 * and "choice" one of its options. Ids keep answers to the question they
 * were given for, whatever is edited.
 */
export const Question = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  type: Schema.Literals(["text", "checkbox", "choice"]),
  text: Schema.String,
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

/** An event's cover image, with a description for those who can't see it. */
export const Cover = Schema.Struct({ src: ImageSrc, alt: Schema.String });
export type Cover = typeof Cover.Type;

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
