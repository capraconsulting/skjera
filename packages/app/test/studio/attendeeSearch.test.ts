import type { AttendeeDetails } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import { searchAttendees } from "../../src/routes/studio/attendance/attendeeSearch.ts";
import { attendeeDetails } from "./attendee.ts";

type Row = { readonly id: string; readonly details: AttendeeDetails | null };

const gina: Row = {
  id: "gina",
  details: attendeeDetails("Gina Guest", {
    email: "gina@example.org",
    phone: "911 11 111",
    company: "Initech",
  }),
};
const bob: Row = {
  id: "bob",
  details: attendeeDetails("Bob Builder", { email: "bob@example.com" }),
};
const nobody: Row = {
  id: "nobody",
  details: attendeeDetails("Nobody", { email: null }),
};
const hidden: Row = { id: "hidden", details: null };

const ids = (rows: ReadonlyArray<Row>) => rows.map(({ id }) => id);

describe("searchAttendees", () => {
  it("keeps those whose email contains the text, ignoring case (AC-2)", () => {
    expect(ids(searchAttendees([gina, bob], "GINA@EXAMPLE"))).toEqual(["gina"]);
  });

  it("keeps those whose phone contains the text, spaces included (AC-2)", () => {
    expect(ids(searchAttendees([gina, bob], "911 11"))).toEqual(["gina"]);
  });

  it("keeps those whose company contains the text, ignoring case (AC-2)", () => {
    expect(ids(searchAttendees([gina, bob], "initech"))).toEqual(["gina"]);
  });

  it("keeps those whose name contains a text found in no other field (AC-2)", () => {
    expect(ids(searchAttendees([gina, bob], "builder"))).toEqual(["bob"]);
  });

  it("keeps no one when the text is in no field (AC-2)", () => {
    expect(searchAttendees([gina, bob], "nobody")).toEqual([]);
  });

  it("does not keep someone with no email, phone or company when searching for one (AC-2)", () => {
    for (const text of ["@", "911", "initech"]) {
      expect(ids(searchAttendees([nobody], text))).toEqual([]);
    }
  });

  it("does not keep a row without details, and does not throw (AC-2)", () => {
    expect(searchAttendees([hidden, gina], "gina").map(({ id }) => id)).toEqual(
      ["gina"],
    );
    expect(searchAttendees([hidden], "x")).toEqual([]);
  });

  it("keeps everyone, in order, for an empty text (AC-3)", () => {
    expect(ids(searchAttendees([gina, bob], ""))).toEqual(["gina", "bob"]);
  });

  it("keeps everyone, in order, for a text of only spaces (AC-3)", () => {
    expect(ids(searchAttendees([gina, bob], "   "))).toEqual(["gina", "bob"]);
  });

  it("ignores spaces before and after the text (AC-3)", () => {
    expect(ids(searchAttendees([gina, bob], "  initech "))).toEqual(["gina"]);
  });
});
