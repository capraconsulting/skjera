import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Effect } from "effect";
import { emailsSent } from "../../src/notices/Mail.tsx";

/** Whether emails are sent with these environment variables set. */
const sentWith = (env: Record<string, string>) =>
  Effect.gen(function* () {
    return yield* emailsSent;
  }).pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
  );

const site = { SITE_URL: "https://events.example", EMAIL_FROM: "a@b.example" };

describe("emailsSent", () => {
  it.effect("is true with smtp and its url, and the site settings (AC-2)", () =>
    Effect.gen(function* () {
      const sent = yield* sentWith({
        ...site,
        EMAIL_TRANSPORT: "smtp",
        EMAIL_SMTP_URL: "smtp://localhost:1025",
      });
      assert.isTrue(sent);
    }),
  );

  it.effect("is true with ses, which needs no url (AC-2)", () =>
    Effect.gen(function* () {
      const sent = yield* sentWith({ ...site, EMAIL_TRANSPORT: "ses" });
      assert.isTrue(sent);
    }),
  );

  it.effect(
    "is false without a transport, or smtp without its url (AC-2)",
    () =>
      Effect.gen(function* () {
        assert.isFalse(yield* sentWith({ ...site }));
        assert.isFalse(yield* sentWith({ ...site, EMAIL_TRANSPORT: "smtp" }));
      }),
  );

  it.effect("is false without SITE_URL or EMAIL_FROM (AC-2)", () =>
    Effect.gen(function* () {
      const transport = {
        EMAIL_TRANSPORT: "smtp",
        EMAIL_SMTP_URL: "smtp://localhost:1025",
      };
      assert.isFalse(
        yield* sentWith({ ...transport, EMAIL_FROM: site.EMAIL_FROM }),
      );
      assert.isFalse(
        yield* sentWith({ ...transport, SITE_URL: site.SITE_URL }),
      );
    }),
  );
});
