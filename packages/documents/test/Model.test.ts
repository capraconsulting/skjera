import { assert, describe, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { GuestDetails } from "../src/Model.ts";

const decode = Schema.decodeUnknownOption(GuestDetails);

const gina = { name: "Gina", email: "gina@example.org" };

describe("GuestDetails", () => {
  it("takes a guest without a phone number or a company (AC-1)", () => {
    assert.deepStrictEqual(Option.getOrNull(decode(gina)), gina);
  });

  it("takes a phone number and a company within their limits (AC-1)", () => {
    const given = { ...gina, phone: "+47 900 00 000", company: "Acme" };
    assert.deepStrictEqual(Option.getOrNull(decode(given)), given);
  });

  it("refuses a phone number over 50 characters and a company over 100 (AC-2)", () => {
    assert.isTrue(Option.isNone(decode({ ...gina, phone: "1".repeat(51) })));
    assert.isTrue(Option.isNone(decode({ ...gina, company: "A".repeat(101) })));
    assert.isTrue(Option.isSome(decode({ ...gina, phone: "1".repeat(50) })));
    assert.isTrue(Option.isSome(decode({ ...gina, company: "A".repeat(100) })));
  });

  it("does not check that a phone number is a number (AC-2)", () => {
    assert.isTrue(Option.isSome(decode({ ...gina, phone: "ring me" })));
  });
});
