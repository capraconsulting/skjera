import { baseLocale, locales } from "@skjera/i18n/runtime";
import { AllowedDomains } from "@skjera/oauth/api";
import { Config, Context, Effect, Layer, Option, Schema } from "effect";

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
  description: Schema.optionalKey(Schema.String),
  locale: Locale,
  footer: Schema.optionalKey(SiteFooter),
  privacy: SitePrivacy,
  /** HubSpot's account, where the site loads HubSpot: `HUBSPOT_ACCOUNT_ID`. */
  hubSpot: Schema.optionalKey(Schema.String),
  /** Emails are sent; absent, as before `/api/site` answers, reads as sent. */
  sendsEmail: Schema.optionalKey(Schema.Boolean),
  /**
   * Sales events are sent to HubSpot: `HUBSPOT_ACCESS_TOKEN` and `SITE_URL`
   * are set. Absent: not sent, and the studio offers no such setting.
   */
  salesEvents: Schema.optionalKey(Schema.Boolean),
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

export const defaultSiteName = "Skjera";
export const defaultSiteTimeZone = "Europe/Oslo";

export interface SiteSettingsValue extends Site {
  readonly url?: string;
  readonly timeZone: string;
  readonly memberDomains: ReadonlyArray<string>;
}

const SiteConfig = Config.all({
  url: optionalSetting("SITE_URL", Config.String),
  name: Config.String("SITE_NAME").pipe(Config.withDefault(defaultSiteName)),
  description: optionalSetting("SITE_DESCRIPTION", Config.String),
  timeZone: optionalSetting("SITE_TIME_ZONE", Config.String).pipe(
    Config.map((timeZone) => timeZone ?? defaultSiteTimeZone),
  ),
  memberDomains: AllowedDomains,
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
    (config): SiteSettingsValue => ({
      ...(config.url === undefined ? {} : { url: config.url }),
      name: config.name,
      ...(config.description === undefined
        ? {}
        : { description: config.description }),
      timeZone: config.timeZone,
      memberDomains: config.memberDomains,
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

export class SiteSettings extends Context.Service<
  SiteSettings,
  SiteSettingsValue
>()("@skjera/documents/SiteSettings") {
  static readonly config = SiteConfig;
  static readonly layer = Layer.effect(
    SiteSettings,
    Effect.gen(function* () {
      return SiteSettings.of(yield* SiteConfig);
    }),
  );
}
/** A guest's phone number, as typed, at most 50 characters; `guestProblems` checks the rest. */
