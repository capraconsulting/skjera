import { describe, expect, it } from "vitest";
import { Identity, nameOf } from "../src/Identity.ts";

const identity = (fields: {
  readonly name?: string;
  readonly email?: string;
}) =>
  new Identity({
    issuer: "https://idp.example",
    subject: "person-123",
    ...fields,
  });

describe("nameOf", () => {
  it("uses the first non-blank trimmed login claim (AC-1)", () => {
    expect(
      nameOf(identity({ name: "  Ada Lovelace  ", email: "ada@example.org" })),
    ).toBe("Ada Lovelace");
    expect(nameOf(identity({ name: "  ", email: "  ada@example.org  " }))).toBe(
      "ada@example.org",
    );
  });

  it("uses the subject when neither name nor email is usable (AC-2)", () => {
    expect(nameOf(identity({}))).toBe("person-123");
    expect(nameOf(identity({ name: " ", email: "\t" }))).toBe("person-123");
  });
});
