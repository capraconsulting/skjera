import { assert, describe, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Exit, Option, Schema } from "effect";
import {
  eventCategory,
  GuestDetails,
  guestProblems,
  isEmailAddress,
  isMobileNumber,
  optionalSetting,
  organizerLogos,
  SiteConfig,
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

  it.effect("reads a set optional site setting as before (AC-7)", () =>
    Effect.gen(function* () {
      const site = yield* readSite({
        SITE_FOOTER: '{"text":"Hello"}',
        SITE_OPERATOR: "Example Ltd",
        SITE_CONTACT_EMAIL: "privacy@example.org",
        SITE_PRIVACY_URL: "https://example.org/privacy",
      });
      assert.isTrue(Exit.isSuccess(site));
      if (Exit.isSuccess(site)) {
        assert.deepStrictEqual(site.value.footer, { text: "Hello" });
        assert.deepStrictEqual(site.value.privacy, {
          operator: "Example Ltd",
          contact: "privacy@example.org",
          url: "https://example.org/privacy",
        });
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
