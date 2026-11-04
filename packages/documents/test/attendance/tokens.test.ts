import { assert, describe, it } from "@effect/vitest";
import { Redacted } from "effect";
import {
  cancelLinkToken,
  guestToken,
  readCancelLink,
  tokenHash,
} from "../../src/attendance/tokens.ts";

const secret = Redacted.make("test-signing-secret");
const attendee = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const event = "0198a1b2-0000-7000-8000-000000000001";
const expiresAt = 1_800_000_000_000;

// Recorded from the service's own code, for the secret, signup, event and
// expiry above: tokens guests hold and links already emailed must keep working.
const recordedToken = "IVmK4S8RY_36yjxIxRRGoEZmGk1JDvmZrJJRUQTTziI";
const recordedHash = "Vl8Nh2asHSMwYpkOS_nRMCsK_yGD02ZZVkeVKOyY2qc";
const recordedLink =
  "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b.1800000000000.Gv-FO0TvjXdN6xtDYs8ul9FulzcHHQc1kHmROU5Je60";

describe("guestToken and tokenHash", () => {
  it("gives the same attendee the same token, others another (AC-2)", () => {
    assert.strictEqual(
      guestToken(secret, attendee),
      guestToken(secret, attendee),
    );
    assert.notStrictEqual(
      guestToken(secret, attendee),
      guestToken(secret, "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c"),
    );
    assert.notStrictEqual(
      guestToken(secret, attendee),
      guestToken(Redacted.make("another-secret"), attendee),
    );
  });

  it("keeps the token a fixed secret and attendee always had (AC-2)", () => {
    assert.strictEqual(guestToken(secret, attendee), recordedToken);
  });

  it("keeps the hash of a token as the database stores it (AC-2)", () => {
    assert.strictEqual(tokenHash(recordedToken), recordedHash);
  });
});

describe("cancelLinkToken and readCancelLink", () => {
  it("keeps the link a fixed secret, event, signup and expiry always had (AC-2)", () => {
    assert.strictEqual(
      cancelLinkToken(secret, event, attendee, expiresAt),
      recordedLink,
    );
  });

  it("names the signup before the expiry (AC-2)", () => {
    const link = cancelLinkToken(secret, event, attendee, expiresAt);
    assert.deepStrictEqual(readCancelLink(secret, event, link, expiresAt - 1), {
      attendee,
    });
  });

  it("is expired at the expiry and after it (AC-2)", () => {
    const link = cancelLinkToken(secret, event, attendee, expiresAt);
    assert.deepStrictEqual(readCancelLink(secret, event, link, expiresAt), {
      problem: "CancelLinkExpired",
    });
    assert.deepStrictEqual(readCancelLink(secret, event, link, expiresAt + 1), {
      problem: "CancelLinkExpired",
    });
  });

  it("is invalid when read for another event or with another secret (AC-2)", () => {
    const link = cancelLinkToken(secret, event, attendee, expiresAt);
    const invalid = { problem: "CancelLinkInvalid" } as const;
    assert.deepStrictEqual(
      readCancelLink(secret, "0198a1b2-0000-7000-8000-000000000002", link, 0),
      invalid,
    );
    assert.deepStrictEqual(
      readCancelLink(Redacted.make("another-secret"), event, link, 0),
      invalid,
    );
  });

  it("is invalid when its signature or expiry was changed (AC-2)", () => {
    const [id = "", expires = "", signature = ""] = cancelLinkToken(
      secret,
      event,
      attendee,
      expiresAt,
    ).split(".");
    const invalid = { problem: "CancelLinkInvalid" } as const;
    assert.deepStrictEqual(
      readCancelLink(secret, event, `${id}.${expires}.${signature}x`, 0),
      invalid,
    );
    assert.deepStrictEqual(
      readCancelLink(
        secret,
        event,
        `${id}.${expires}.${signature.slice(1)}`,
        0,
      ),
      invalid,
    );
    assert.deepStrictEqual(
      readCancelLink(
        secret,
        event,
        `${id}.${Number(expires) + 1}.${signature}`,
        0,
      ),
      invalid,
    );
  });

  it("is invalid with an extra part, a number that is none, or no token (AC-2)", () => {
    const link = cancelLinkToken(secret, event, attendee, expiresAt);
    const invalid = { problem: "CancelLinkInvalid" } as const;
    assert.deepStrictEqual(
      readCancelLink(secret, event, `${link}.x`, 0),
      invalid,
    );
    assert.deepStrictEqual(
      readCancelLink(
        secret,
        event,
        cancelLinkToken(secret, event, attendee, Number.NaN),
        0,
      ),
      invalid,
    );
    assert.deepStrictEqual(readCancelLink(secret, event, "", 0), invalid);
    assert.deepStrictEqual(
      readCancelLink(secret, event, "not a token", 0),
      invalid,
    );
  });
});
