import { describe, expect, it } from "@effect/vitest";
import {
  accountDomain,
  emailDomain,
  googleIssuer,
  isDomainAllowed,
} from "../src/internal/allowedDomains.ts";

describe("accountDomain", () => {
  it("uses the hd claim for Google", () => {
    expect(
      accountDomain(
        googleIssuer,
        { hd: "Example.com", email: "a@example.com", email_verified: true },
        "email",
      ),
    ).toBe("example.com");
  });

  it("ignores the email domain for Google accounts outside a Workspace", () => {
    expect(
      accountDomain(
        googleIssuer,
        { email: "a@example.com", email_verified: true },
        "email",
      ),
    ).toBeUndefined();
  });

  it("uses the verified email domain for other providers", () => {
    expect(
      accountDomain(
        "https://idp.example",
        { email: "A@Example.com", email_verified: true },
        "email",
      ),
    ).toBe("example.com");
    expect(
      accountDomain(
        "https://idp.example",
        { upn: "a@example.com", email_verified: "true" },
        "upn",
      ),
    ).toBe("example.com");
  });

  it.each([
    [{ email: "a@example.com" }],
    [{ email: "a@example.com", email_verified: false }],
    [{ email: "no-at-sign", email_verified: true }],
    [{ email_verified: true }],
  ])("has no domain for %j", (claims) => {
    expect(
      accountDomain("https://idp.example", claims, "email"),
    ).toBeUndefined();
  });
});

describe("emailDomain", () => {
  it("extracts a normalized domain from a plain email address (AC-4)", () => {
    expect(emailDomain(" Bob@EXAMPLE.com ")).toBe("example.com");
    expect(emailDomain("no-at-sign")).toBeUndefined();
  });
});

describe("isDomainAllowed", () => {
  it("allows everyone when no domains are configured", () => {
    expect(isDomainAllowed([], undefined)).toBe(true);
  });

  it("only allows exact matches", () => {
    expect(isDomainAllowed(["example.com"], "example.com")).toBe(true);
    expect(isDomainAllowed(["example.com"], "sub.example.com")).toBe(false);
    expect(isDomainAllowed(["example.com"], "example.com.evil")).toBe(false);
    expect(isDomainAllowed(["example.com"], undefined)).toBe(false);
  });
});
