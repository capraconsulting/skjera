import { describe, expect, it } from "vitest";
import {
  checkboxWords,
  chosenOption,
  fieldOf,
} from "../src/site/signupForm.ts";

const small = "00000000-0000-4000-8000-000000000001";
const large = "00000000-0000-4000-8000-000000000002";
const towels = "00000000-0000-4000-8000-0000000000aa";
const question = {
  id: towels,
  options: [
    { id: small, text: "Small" },
    { id: large, text: "Large" },
  ],
};

describe("chosenOption", () => {
  it("is the first option when nothing was answered (AC-6)", () => {
    expect(chosenOption(question, undefined)).toBe(small);
    expect(chosenOption(question, {})).toBe(small);
  });

  it("is the option answered before, when it is still offered (AC-6)", () => {
    expect(chosenOption(question, { [towels]: large })).toBe(large);
  });

  it("is the first option when the answer is no longer offered (AC-6)", () => {
    expect(chosenOption(question, { [towels]: "gone" })).toBe(small);
    expect(chosenOption(question, { [towels]: true })).toBe(small);
  });
});

describe("checkboxWords", () => {
  it("puts the question above the box and its answer option beside it (AC-2)", () => {
    expect(
      checkboxWords({
        text: "Skal du bade?",
        label: "Ja, jeg vil leie badebukse",
      }),
    ).toEqual({ above: "Skal du bade?", beside: "Ja, jeg vil leie badebukse" });
  });

  it("puts the question beside the box when it has no answer option, or a blank one (AC-3)", () => {
    const text = "I accept the risks of swimming";
    for (const given of [
      { text },
      { text, label: "" },
      { text, label: "   " },
    ]) {
      expect(checkboxWords(given)).toEqual({
        above: undefined,
        beside: text,
      });
    }
  });
});

describe("fieldOf", () => {
  it("puts each guest problem under the input it belongs to (AC-1, AC-2, AC-3, AC-4)", () => {
    expect(fieldOf({ _tag: "GuestNameTooShort" })).toBe("firstname");
    expect(fieldOf({ _tag: "GuestCompanyTooShort" })).toBe("company");
    expect(fieldOf({ _tag: "GuestPhoneInvalid" })).toBe("telephone");
    expect(fieldOf({ _tag: "MemberEmail" })).toBe("email");
  });

  it("puts any other problem, and anything that is not one, under no field (AC-1)", () => {
    expect(fieldOf({ _tag: "EmailTaken" })).toBeUndefined();
    expect(fieldOf({ _tag: "Unheard of" })).toBeUndefined();
    expect(fieldOf(undefined)).toBeUndefined();
    expect(fieldOf("EmailTaken")).toBeUndefined();
  });
});
