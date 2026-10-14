import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Option, Schema } from "effect";
import {
  GuestDetails,
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

  it("does not check that a phone number is a number", () => {
    assert.isTrue(Option.isSome(decode({ ...gina, phone: "ring me" })));
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
});
