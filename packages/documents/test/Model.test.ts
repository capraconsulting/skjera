import { assert, describe, it } from "@effect/vitest";
import {
  Cause,
  Config,
  ConfigProvider,
  Effect,
  Exit,
  Option,
  Schema,
} from "effect";
import {
  Cover,
  eventCategory,
  GuestDetails,
  guestProblems,
  isEmailAddress,
  isMobileNumber,
  isVersion,
  optionalSetting,
  organizerLogos,
  Question,
  SiteConfig,
  shownCover,
  TeamLogosChange,
} from "../src/Model.ts";

const decode = Schema.decodeUnknownOption(GuestDetails);

const gina = { name: "Gina", email: "gina@example.org" };

describe("GuestDetails", () => {
  it("takes a guest without a phone number or a company", () => {
    assert.deepStrictEqual(Option.getOrNull(decode(gina)), gina);
  });

  it("takes a phone number and a company within their limits", () => {
    const given = { ...gina, phone: "+47 900 00 000", company: "Acme" };
    assert.deepStrictEqual(Option.getOrNull(decode(given)), given);
  });

  it("refuses a phone number over 50 characters and a company over 100", () => {
    assert.isTrue(Option.isNone(decode({ ...gina, phone: "1".repeat(51) })));
    assert.isTrue(Option.isNone(decode({ ...gina, company: "A".repeat(101) })));
    assert.isTrue(Option.isSome(decode({ ...gina, phone: "1".repeat(50) })));
    assert.isTrue(Option.isSome(decode({ ...gina, company: "A".repeat(100) })));
  });
});

describe("Question", () => {
  const decodeQuestion = Schema.decodeUnknownOption(Question);
  const swim = {
    id: "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a05",
    type: "checkbox",
    text: "Skal du bade?",
    required: false,
    options: [],
  } as const;

  it("keeps a checkbox question's answer option (AC-1)", () => {
    const labelled = { ...swim, label: "Ja, jeg vil leie badebukse" };
    assert.deepStrictEqual(
      Option.getOrNull(decodeQuestion(labelled)),
      labelled,
    );
  });

  it("takes a question made without an answer option, as before (AC-3)", () => {
    assert.deepStrictEqual(Option.getOrNull(decodeQuestion(swim)), swim);
  });
});

describe("isEmailAddress", () => {
  it("takes something@something.something, trimmed, of at most 254 characters (AC-3)", () => {
    assert.isTrue(isEmailAddress("gina@example.org"));
    assert.isTrue(isEmailAddress(" gina@example.org "));
    const longest = `${"a".repeat(254 - "@example.org".length)}@example.org`;
    assert.isTrue(isEmailAddress(longest));
    for (const given of [
      "",
      "gina",
      "gina@example",
      "gi na@example.org",
      `a${longest}`,
    ]) {
      assert.isFalse(isEmailAddress(given), given);
    }
  });

  it("is the rule a guest's email follows (AC-3)", () => {
    assert.isTrue(Option.isNone(decode({ ...gina, email: "gina@example" })));
    assert.isTrue(Option.isSome(decode({ ...gina, email: " g@example.org " })));
  });
});

const tags = (guest: Parameters<typeof guestProblems>[0]) =>
  guestProblems(guest).map((problem) => problem._tag);

describe("guestProblems", () => {
  it("wants a name of two characters once trimmed (AC-2)", () => {
    assert.deepStrictEqual(tags({ name: "G" }), ["GuestNameTooShort"]);
    assert.deepStrictEqual(tags({ name: " G " }), ["GuestNameTooShort"]);
    assert.deepStrictEqual(tags({ name: "Gi" }), []);
  });

  it("wants a company, when given, of two characters (AC-3)", () => {
    assert.deepStrictEqual(tags({ company: "A" }), ["GuestCompanyTooShort"]);
    for (const company of ["", "   ", "AB"]) {
      assert.deepStrictEqual(tags({ company }), []);
    }
  });

  it("wants a phone number, when given, that is a mobile number (AC-4)", () => {
    for (const phone of [
      "111",
      "22 00 00 00",
      "+47 22 00 00 00",
      "ring me",
      "+1 23",
    ]) {
      assert.deepStrictEqual(tags({ phone }), ["GuestPhoneInvalid"], phone);
    }
    for (const phone of [
      "",
      "900 00 000",
      "+47 412 34 567",
      "004791234567",
      "+46 70 123 45 67",
    ]) {
      assert.deepStrictEqual(tags({ phone }), [], phone);
    }
  });

  it("gives every refused field at once, and checks only those given (AC-2, AC-3, AC-4)", () => {
    assert.deepStrictEqual(tags({ name: "G", company: "A", phone: "111" }), [
      "GuestNameTooShort",
      "GuestCompanyTooShort",
      "GuestPhoneInvalid",
    ]);
    assert.deepStrictEqual(tags({ phone: "111" }), ["GuestPhoneInvalid"]);
  });
});

describe("isMobileNumber", () => {
  it("ignores spaces, dashes, dots and brackets (AC-4)", () => {
    for (const phone of [
      "900-00-000",
      "(+47) 900.00.000",
      "+47 (900) 00 000",
    ]) {
      assert.isTrue(isMobileNumber(phone), phone);
    }
  });
});

const decodeChange = Schema.decodeUnknownOption(TeamLogosChange);

const uploaded = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
const other = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";

describe("TeamLogosChange", () => {
  it("takes uploaded images' addresses, null, and leaving a logo out", () => {
    for (const given of [
      {},
      { logo: uploaded },
      { logoDark: other },
      { logo: null, logoDark: null },
      { logo: uploaded, logoDark: null },
    ]) {
      assert.deepStrictEqual(Option.getOrNull(decodeChange(given)), given);
    }
  });

  it("refuses an address that is not an uploaded image's", () => {
    assert.isTrue(
      Option.isNone(decodeChange({ logo: "https://example.com/logo.png" })),
    );
    assert.isTrue(
      Option.isNone(decodeChange({ logoDark: "/api/images/short" })),
    );
  });
});

describe("organizerLogos", () => {
  it("shows the light logo in the light theme, and never the dark one", () => {
    assert.strictEqual(
      organizerLogos({ logo: uploaded, logoDark: other }).light,
      uploaded,
    );
    assert.isNull(organizerLogos({ logo: null, logoDark: other }).light);
    assert.isNull(organizerLogos({ logo: null, logoDark: null }).light);
  });

  it("shows the dark logo in the dark theme, else the light one, else none", () => {
    assert.strictEqual(
      organizerLogos({ logo: uploaded, logoDark: other }).dark,
      other,
    );
    assert.strictEqual(
      organizerLogos({ logo: uploaded, logoDark: null }).dark,
      uploaded,
    );
    assert.isNull(organizerLogos({ logo: null, logoDark: null }).dark);
  });
});

/** The site as the server reads it from these environment variables. */
const readSite = (env: Record<string, string>) =>
  Effect.exit(
    Effect.gen(function* () {
      return yield* SiteConfig;
    }),
  ).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))));

describe("SiteConfig", () => {
  it.effect("gives the app the HubSpot account id", () =>
    Effect.gen(function* () {
      const site = yield* readSite({ HUBSPOT_ACCOUNT_ID: "146072525" });
      assert.isTrue(Exit.isSuccess(site));
      if (Exit.isSuccess(site)) {
        assert.strictEqual(site.value.hubSpot, "146072525");
      }
    }),
  );

  it.effect(
    "has the language set in SITE_LOCALE, else English (ACC-06 AC-6)",
    () =>
      Effect.gen(function* () {
        const set = yield* readSite({ SITE_LOCALE: "nn" });
        assert.isTrue(Exit.isSuccess(set));
        if (Exit.isSuccess(set)) {
          assert.strictEqual(set.value.locale, "nn");
        }
        const unset = yield* readSite({});
        assert.isTrue(Exit.isSuccess(unset));
        if (Exit.isSuccess(unset)) {
          assert.strictEqual(unset.value.locale, "en");
        }
      }),
  );

  it.effect("refuses an account id that is not digits", () =>
    Effect.gen(function* () {
      for (const given of ["abc", "1460/72525", "146072525.js", "14 6"]) {
        const site = yield* readSite({ HUBSPOT_ACCOUNT_ID: given });
        assert.isTrue(Exit.isFailure(site), given);
      }
    }),
  );

  it.effect(
    "has no HubSpot key without an account id, or with a blank one",
    () =>
      Effect.gen(function* () {
        for (const env of [
          {},
          { HUBSPOT_ACCOUNT_ID: "" },
          { HUBSPOT_ACCOUNT_ID: "  " },
        ]) {
          const site = yield* readSite(env);
          assert.isTrue(Exit.isSuccess(site));
          if (Exit.isSuccess(site)) assert.notProperty(site.value, "hubSpot");
        }
      }),
  );

  it.effect("reads a blank optional site setting as not set (AC-7, AC-8)", () =>
    Effect.gen(function* () {
      for (const blank of ["", "  "]) {
        const site = yield* readSite({
          SITE_NAME: "Example Events",
          SITE_FOOTER: blank,
          SITE_OPERATOR: blank,
          SITE_OPERATOR_ORG_NUMBER: blank,
          SITE_OPERATOR_ADDRESS: blank,
          SITE_CONTACT_EMAIL: blank,
          SITE_PRIVACY_URL: blank,
        });
        assert.isTrue(Exit.isSuccess(site), JSON.stringify(blank));
        if (Exit.isSuccess(site)) {
          assert.notProperty(site.value, "footer");
          assert.deepStrictEqual(site.value.privacy, {
            operator: "Example Events",
          });
        }
      }
    }),
  );

  it.effect(
    "names the configured operator, or the site's name when none is (AC-4)",
    () =>
      Effect.gen(function* () {
        const named = yield* readSite({
          SITE_NAME: "Example Events",
          SITE_OPERATOR: "Example Ltd",
        });
        const unnamed = yield* readSite({ SITE_NAME: "Example Events" });
        assert.isTrue(Exit.isSuccess(named) && Exit.isSuccess(unnamed));
        if (Exit.isSuccess(named)) {
          assert.strictEqual(named.value.privacy.operator, "Example Ltd");
        }
        if (Exit.isSuccess(unnamed)) {
          assert.strictEqual(unnamed.value.privacy.operator, "Example Events");
        }
      }),
  );

  it.effect("reads a set optional site setting as before (AC-7)", () =>
    Effect.gen(function* () {
      const site = yield* readSite({
        SITE_FOOTER: '{"text":"Hello"}',
        SITE_OPERATOR: "Example Ltd",
        SITE_OPERATOR_ORG_NUMBER: "123 456 789",
        SITE_OPERATOR_ADDRESS: "Example Street 2, 0180 Oslo",
        SITE_CONTACT_EMAIL: "privacy@example.org",
        SITE_PRIVACY_URL: "https://example.org/privacy",
      });
      assert.isTrue(Exit.isSuccess(site));
      if (Exit.isSuccess(site)) {
        assert.deepStrictEqual(site.value.footer, { text: "Hello" });
        assert.deepStrictEqual(site.value.privacy, {
          operator: "Example Ltd",
          orgNumber: "123 456 789",
          address: "Example Street 2, 0180 Oslo",
          contact: "privacy@example.org",
          url: "https://example.org/privacy",
        });
      }
    }),
  );

  it.effect(
    "reads a footer with a heading, groups and per-language texts (AC-1, AC-2, AC-3, AC-6)",
    () =>
      Effect.gen(function* () {
        const footer = {
          heading: { nb: "Vi er en del av Capra-gruppen", en: "Part of Capra" },
          groups: [
            {
              title: { nb: "Sertifiseringer", nn: "Sertifiseringar" },
              logos: [
                { label: "DNV", src: "/dnv.webp", darkSrc: "/dnv-dark.webp" },
              ],
            },
            {
              logos: [
                {
                  label: { nb: "Capra-logo", en: "Capra logo" },
                  src: "/capra.webp",
                  href: "https://www.capraconsulting.no/",
                },
              ],
            },
          ],
          text: { nb: "{year} © Capra" },
        };
        const site = yield* readSite({ SITE_FOOTER: JSON.stringify(footer) });
        assert.isTrue(Exit.isSuccess(site));
        if (Exit.isSuccess(site)) {
          assert.deepStrictEqual(site.value.footer, footer);
        }
      }),
  );

  it.effect("reads a footer in today's form unchanged (AC-7)", () =>
    Effect.gen(function* () {
      const footer = {
        text: "Skjera · Events, together · privacy@skjera.localhost",
        links: [
          {
            label: "Example Ltd",
            href: "https://example.com",
            logo: {
              src: "/site-assets/logo.svg",
              darkSrc: "/site-assets/logo-dark.svg",
            },
          },
        ],
      };
      const site = yield* readSite({ SITE_FOOTER: JSON.stringify(footer) });
      assert.isTrue(Exit.isSuccess(site));
      if (Exit.isSuccess(site)) {
        assert.deepStrictEqual(site.value.footer, footer);
      }
    }),
  );

  it.effect(
    "refuses a footer that is not valid, naming SITE_FOOTER (AC-8)",
    () =>
      Effect.gen(function* () {
        for (const given of [
          '{"groups":[{"logos":[{"label":"DNV"}]}]}',
          '{"heading":{"en":"Part of Capra"}}',
          '{"groups":[{"title":"Certifications"}]}',
          '{"heading":42}',
          "not json",
        ]) {
          const site = yield* readSite({ SITE_FOOTER: given });
          assert.isTrue(Exit.isFailure(site), given);
          if (Exit.isFailure(site)) {
            assert.include(Cause.pretty(site.cause), "SITE_FOOTER", given);
          }
        }
      }),
  );
});

describe("optionalSetting", () => {
  const read = (env: Record<string, string>) =>
    Effect.runSync(
      Effect.provide(
        Effect.gen(function* () {
          return yield* optionalSetting("SITE_URL", Config.String);
        }),
        ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
      ),
    );

  it("reads a blank SITE_URL, or none, as not set (AC-7)", () => {
    for (const env of [{}, { SITE_URL: "" }, { SITE_URL: "  " }]) {
      assert.isUndefined(read(env));
    }
    assert.strictEqual(
      read({ SITE_URL: "https://example.org" }),
      "https://example.org",
    );
  });
});

describe("eventCategory", () => {
  it("is Sosialt or Fag for a tag of that name, ignoring case (AC-9)", () => {
    assert.strictEqual(eventCategory(["Workshop", "sosialt"]), "Sosialt");
    assert.strictEqual(eventCategory(["FAG"]), "Fag");
    assert.strictEqual(eventCategory(["SOSIALT"]), "Sosialt");
  });

  it("is the first of the tags that names one (AC-9)", () => {
    assert.strictEqual(eventCategory(["Fag", "Sosialt"]), "Fag");
    assert.strictEqual(eventCategory(["Sosialt", "Fag"]), "Sosialt");
  });

  it("is none for other tags or no tags (AC-9)", () => {
    assert.isNull(eventCategory(["Faglig"]));
    assert.isNull(eventCategory(["Sosialt arrangement"]));
    assert.isNull(eventCategory([]));
  });
});

const picture = "/api/images/AAAAAAAAAAAAAAAAAAAAAA";
const part = "/api/images/BBBBBBBBBBBBBBBBBBBBBB";

const cropOf = (over: Record<string, unknown> = {}) => ({
  x: 0,
  y: 0,
  width: 0.5,
  height: 1,
  from: picture,
  src: part,
  ...over,
});

const decodeCover = Schema.decodeUnknownOption(Cover);

describe("Cover", () => {
  it("takes a crop and a focal point inside the picture, and neither (AC-1)", () => {
    const plain = { src: picture, alt: "" };
    for (const given of [
      plain,
      { ...plain, crop: cropOf() },
      { ...plain, focus: { x: 0.8, y: 0.3 } },
      { ...plain, crop: cropOf({ x: 0.5, width: 0.5 }), focus: { x: 0, y: 1 } },
    ]) {
      assert.deepStrictEqual(Option.getOrNull(decodeCover(given)), given);
    }
  });

  it("refuses a crop that reaches outside the picture, has no width, or is not an uploaded image (AC-1)", () => {
    const plain = { src: picture, alt: "" };
    for (const crop of [
      cropOf({ x: 0.6 }),
      cropOf({ height: 1.2 }),
      cropOf({ x: -0.1 }),
      cropOf({ width: 0 }),
      cropOf({ height: 0 }),
      cropOf({ src: "https://example.com/x.png" }),
      cropOf({ from: "https://example.com/x.png" }),
    ]) {
      assert.isTrue(
        Option.isNone(decodeCover({ ...plain, crop })),
        JSON.stringify(crop),
      );
    }
  });

  it("refuses a focal point outside 0 to 1 (AC-1)", () => {
    for (const focus of [
      { x: 1.1, y: 0.5 },
      { x: 0.5, y: -0.2 },
    ]) {
      assert.isTrue(
        Option.isNone(decodeCover({ src: picture, alt: "", focus })),
        JSON.stringify(focus),
      );
    }
  });
});

describe("shownCover", () => {
  const plain = { src: picture, alt: "" };

  it("gives the picture, cut around its centre, when there is no crop or focal point (AC-4)", () => {
    assert.deepStrictEqual(shownCover(plain), {
      src: picture,
      position: "50% 50%",
    });
  });

  it("gives the crop's file when the crop is of the cover's picture (AC-2)", () => {
    assert.strictEqual(shownCover({ ...plain, crop: cropOf() }).src, part);
  });

  it("gives the picture when the crop was cut from another picture (AC-5)", () => {
    const stale = cropOf({ from: "/api/images/CCCCCCCCCCCCCCCCCCCCCC" });
    assert.deepStrictEqual(
      shownCover({ ...plain, crop: stale, focus: { x: 0.8, y: 0.3 } }),
      { src: picture, position: "80% 30%" },
    );
  });

  it("centres the part shown when a crop has no focal point (AC-3, AC-4)", () => {
    const crop = cropOf({ x: 0.5, width: 0.5 });
    assert.strictEqual(shownCover({ ...plain, crop }).position, "50% 50%");
  });

  it("ignores a focal point set on another picture (AC-5)", () => {
    const stale = {
      x: 0.8,
      y: 0.3,
      from: "/api/images/CCCCCCCCCCCCCCCCCCCCCC",
    };
    assert.strictEqual(
      shownCover({ ...plain, focus: stale }).position,
      "50% 50%",
    );
    assert.strictEqual(
      shownCover({ ...plain, focus: { ...stale, from: picture } }).position,
      "80% 30%",
    );
  });

  it("puts the focal point as far into the box as it is into the picture (AC-3)", () => {
    assert.strictEqual(
      shownCover({ ...plain, focus: { x: 0.8, y: 0.3 } }).position,
      "80% 30%",
    );
  });

  it("measures the focal point against the crop, as far into the part as into the picture (AC-3)", () => {
    const crop = cropOf({ x: 0.5, y: 0, width: 0.5, height: 1 });
    assert.strictEqual(
      shownCover({ ...plain, crop, focus: { x: 0.8, y: 0.3 } }).position,
      "60% 30%",
    );
  });

  it("holds a focal point outside the crop at the crop's nearest edge (AC-3)", () => {
    const crop = cropOf({ x: 0.5, y: 0.25, width: 0.25, height: 0.5 });
    assert.strictEqual(
      shownCover({ ...plain, crop, focus: { x: 0.1, y: 0.9 } }).position,
      "0% 100%",
    );
    assert.strictEqual(
      shownCover({ ...plain, crop, focus: { x: 0.95, y: 0 } }).position,
      "100% 0%",
    );
  });

  it("rounds the percentages to two decimals, with no trailing zeros (AC-3)", () => {
    const crop = cropOf({ x: 0.5, width: 0.5 });
    // (0.8 - 0.5) / 0.5 * 100 is 60.00000000000001 in JavaScript.
    assert.strictEqual(
      shownCover({ ...plain, crop, focus: { x: 0.8, y: 1 / 3 } }).position,
      "60% 33.33%",
    );
  });

  it("gives the picture and its centre once the crop and the focal point are gone (AC-8)", () => {
    const {
      crop: _crop,
      focus: _focus,
      ...reset
    } = {
      ...plain,
      crop: cropOf(),
      focus: { x: 0.8, y: 0.3 },
    };
    assert.deepStrictEqual(shownCover(reset), {
      src: picture,
      position: "50% 50%",
    });
  });
});

describe("Version", () => {
  const hash = "a".repeat(64);

  it("is a non-empty list of change hashes (AC-3)", () => {
    assert.isTrue(isVersion([hash]));
    assert.isTrue(isVersion([hash, "0123456789abcdef".repeat(4)]));
    assert.isFalse(isVersion([]));
    assert.isFalse(isVersion([hash.toUpperCase()]));
    assert.isFalse(isVersion([hash.slice(1)]));
    assert.isFalse(isVersion([`${hash}0`]));
    assert.isFalse(isVersion(["not a hash"]));
    assert.isFalse(isVersion([hash, "g".repeat(64)]));
  });
});
