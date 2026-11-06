import type { Question } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import {
  changeFrom,
  checkboxWords,
  chosenOption,
  fieldOf,
  questionField,
  salesEventForm,
  signupFrom,
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

const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  return form;
};

const nickname = "00000000-0000-4000-8000-0000000000b1";
const notes = "00000000-0000-4000-8000-0000000000b2";
const waiver = "00000000-0000-4000-8000-0000000000b3";
const updates = "00000000-0000-4000-8000-0000000000b4";
const asked = (
  id: string,
  type: Question["type"],
  options: Question["options"] = [],
): Question => ({ id, type, text: "Question", required: false, options });
const questions = [
  asked(nickname, "text"),
  asked(notes, "text"),
  asked(waiver, "checkbox"),
  asked(updates, "checkbox"),
  asked(towels, "choice", question.options),
];
const plain = { questions: [], isStreamed: false, isSalesEvent: false };
const streamed = { questions: [], isStreamed: true, isSalesEvent: false };
const withQuestions = { questions, isStreamed: false, isSalesEvent: false };
const sales = { questions: [], isStreamed: false, isSalesEvent: true };

describe("signupFrom", () => {
  it("reads a member's answers by question id (AC-2)", () => {
    const form = formOf({
      [questionField({ id: nickname })]: "Nico",
      [questionField({ id: waiver })]: "on",
      [questionField({ id: towels })]: large,
    });
    expect(signupFrom(withQuestions, form, false, "nb")).toEqual({
      locale: "nb",
      answers: {
        [nickname]: "Nico",
        [waiver]: true,
        [updates]: false,
        [towels]: large,
      },
    });
  });

  it("reads a guest's details as written, the email untrimmed, and the hidden field (AC-3)", () => {
    const form = formOf({
      firstname: "Kari Nordmann",
      email: "  kari@example.com ",
      telephone: "91234567",
      company: "Acme",
      subject: "spam",
    });
    expect(signupFrom(plain, form, true, "en")).toEqual({
      locale: "en",
      answers: {},
      guest: {
        name: "Kari Nordmann",
        email: "  kari@example.com ",
        phone: "91234567",
        company: "Acme",
      },
      honeypot: "spam",
    });
  });

  it("gives a guest empty strings for the fields left out of the form (AC-3)", () => {
    expect(signupFrom(plain, formOf({}), true, "en")).toMatchObject({
      guest: { name: "", email: "", phone: "", company: "" },
      honeypot: "",
    });
  });

  it("has dietary only when the form has the field (AC-4)", () => {
    const asked = signupFrom(plain, formOf({ dietary: "Vegan" }), false, "nb");
    expect(asked.dietary).toBe("Vegan");
    const notAsked = signupFrom(plain, formOf({}), false, "nb");
    expect("dietary" in notAsked).toBe(false);
  });

  it("has online only when the event is streamed (AC-5)", () => {
    const online = formOf({ attendance: "online" });
    const inPerson = formOf({ attendance: "in-person" });
    expect(signupFrom(streamed, online, false, "nb").online).toBe(true);
    expect(signupFrom(streamed, inPerson, false, "nb").online).toBe(false);
    expect("online" in signupFrom(plain, online, false, "nb")).toBe(false);
  });
});

describe("signupFrom's ad source", () => {
  const source = { utm_source: "linkedin", li_fat_id: "abc" };

  it("carries the source on a member's and a guest's signup (AC-1)", () => {
    const form = formOf({ firstname: "Kari", email: "kari@example.com" });
    expect(signupFrom(plain, form, false, "en", source).source).toEqual(source);
    expect(signupFrom(plain, form, true, "en", source).source).toEqual(source);
  });

  it("has no source key when it is given none (AC-1)", () => {
    const form = formOf({});
    expect("source" in signupFrom(plain, form, false, "en")).toBe(false);
    expect("source" in signupFrom(plain, form, true, "en", undefined)).toBe(
      false,
    );
  });
});

describe("a sales event's guest form", () => {
  it("sends the job title as written, only for a sales event (AC-8)", () => {
    const form = formOf({
      firstname: "Kari Nordmann",
      email: "kari@example.com",
      jobtitle: "CTO",
    });
    expect(signupFrom(sales, form, true, "en")).toMatchObject({
      guest: { name: "Kari Nordmann", jobTitle: "CTO" },
    });
    expect(signupFrom(sales, formOf({}), true, "en")).toMatchObject({
      guest: { jobTitle: "" },
    });
    const other = signupFrom(plain, form, true, "en");
    expect(other.guest).toBeDefined();
    expect("jobTitle" in (other.guest ?? {})).toBe(false);
  });

  it("asks for a job title and is kept out of HubSpot's collected forms, on a sales event only (AC-8, AC-9)", () => {
    expect(salesEventForm(sales)).toEqual({
      askJobTitle: true,
      formAttributes: { "data-hs-do-not-collect": "true" },
    });
    expect(salesEventForm(plain)).toEqual({
      askJobTitle: false,
      formAttributes: {},
    });
  });
});

describe("changeFrom", () => {
  it("reads a guest's phone and company as written, an empty one as an empty string (AC-6)", () => {
    expect(
      changeFrom(plain, formOf({ telephone: "91234567", company: "" }), true),
    ).toEqual({ answers: {}, phone: "91234567", company: "" });
    expect(changeFrom(plain, formOf({}), true)).toEqual({
      answers: {},
      phone: "",
      company: "",
    });
  });

  it("gives a member no phone or company (AC-6)", () => {
    const changed = changeFrom(
      plain,
      formOf({ telephone: "91234567", company: "Acme" }),
      false,
    );
    expect(changed).toEqual({ answers: {} });
  });

  it("reads the answers (AC-6)", () => {
    const form = formOf({ [questionField({ id: nickname })]: "Nico" });
    expect(changeFrom(withQuestions, form, false).answers).toEqual({
      [nickname]: "Nico",
      [waiver]: false,
      [updates]: false,
    });
  });

  it("has online only when the event is streamed (AC-5)", () => {
    const online = formOf({ attendance: "online" });
    expect(changeFrom(streamed, online, false).online).toBe(true);
    expect(
      changeFrom(streamed, formOf({ attendance: "in-person" }), false).online,
    ).toBe(false);
    expect("online" in changeFrom(plain, online, false)).toBe(false);
  });
});
