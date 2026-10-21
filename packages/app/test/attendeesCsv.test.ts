import type { Answer, AttendeeRow, EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { attendeesCsv } from "../src/routes/studio/attendeesCsv.ts";

const towelSize = "11111111-1111-4111-8111-111111111111";
const heardOf = "22222222-2222-4222-8222-222222222222";

const event = {
  isStreamed: false,
  questions: [
    {
      id: towelSize,
      type: "text",
      text: "Towel size",
      required: false,
      options: [],
    },
  ],
} satisfies Pick<EventRow, "questions" | "isStreamed">;

const answer = (id: string, question: string, text: string): Answer => ({
  id,
  question,
  answer: text,
  value: text,
});

const attendee = (
  name: string,
  answers: ReadonlyArray<Answer>,
  times: { signedUpAt: string; changedAt: string } = {
    signedUpAt: "2026-10-20T08:15:00.000Z",
    changedAt: "2026-10-20T08:15:00.000Z",
  },
): AttendeeRow => ({
  id: name,
  eventId: "33333333-3333-4333-8333-333333333333" as AttendeeRow["eventId"],
  signedUpAt: new Date(times.signedUpAt),
  changedAt: new Date(times.changedAt),
  mine: false,
  online: false,
  details: {
    name,
    email: null,
    phone: null,
    company: null,
    answers,
    guest: false,
  },
});

/** The spreadsheet read back: the header line, and a row per attendee. */
const read = (attendees: ReadonlyArray<AttendeeRow>) => {
  const { data, meta } = Papa.parse<Record<string, string>>(
    attendeesCsv(event, attendees),
    { header: true, skipEmptyLines: true },
  );
  return { rows: data, columns: meta.fields ?? [] };
};

describe("attendeesCsv", () => {
  it("gives sign-up and change times in UTC (AC-10)", () => {
    // 10:15 and 10:20 in Oslo, which is two hours ahead of UTC in October.
    const { rows } = read([
      attendee("Alice", [], {
        signedUpAt: "2026-10-20T10:15:00+02:00",
        changedAt: "2026-10-20T10:20:00+02:00",
      }),
    ]);
    expect(rows[0]?.[m.csv_signed_up()]).toBe("2026-10-20T08:15:00.000Z");
    expect(rows[0]?.[m.csv_changed()]).toBe("2026-10-20T08:20:00.000Z");
  });

  it("gives the same time in both columns for someone who changed nothing (AC-10)", () => {
    const { rows } = read([attendee("Alice", [])]);
    expect(rows[0]?.[m.csv_signed_up()]).toBe("2026-10-20T08:15:00.000Z");
    expect(rows[0]?.[m.csv_changed()]).toBe(rows[0]?.[m.csv_signed_up()]);
  });

  it("keeps the column of a question taken off the event, last (AC-11)", () => {
    const { rows, columns } = read([
      attendee("Alice", [
        answer(towelSize, "Towel size", "Large"),
        answer(heardOf, "Where did you hear of it?", "A friend"),
      ]),
      attendee("Gina", [answer(towelSize, "Towel size", "Small")]),
    ]);
    expect(columns.at(-1)).toBe("Where did you hear of it?");
    expect(columns.at(-2)).toBe("Towel size");
    expect(rows[0]?.["Where did you hear of it?"]).toBe("A friend");
    expect(rows[0]?.["Towel size"]).toBe("Large");
    expect(rows[1]?.["Where did you hear of it?"]).toBe("");
    expect(rows[1]?.["Towel size"]).toBe("Small");
  });

  it("writes an answer that starts like a formula as text (AC-12)", () => {
    const { rows } = read([
      attendee("Alice", [answer(towelSize, "Towel size", "=1+1")]),
      attendee("Gina", [answer(towelSize, "Towel size", "Small")]),
    ]);
    expect(rows[0]?.["Towel size"]).toBe("'=1+1");
    expect(rows[1]?.["Towel size"]).toBe("Small");
  });

  it("heads a question's column with the words its answers were given to (AC-5)", () => {
    const { rows, columns } = read([
      attendee("Alice", [answer(towelSize, "Towel size?", "Large")]),
      attendee("Gina", [answer(towelSize, "Towel size", "Small")]),
    ]);
    expect(rows[1]?.["Towel size"]).toBe("Small");
    expect(rows[0]?.["Towel size"]).toBe("");
    expect(columns.indexOf("Towel size")).toBeLessThan(
      columns.indexOf("Towel size?"),
    );

    const same = read([
      attendee("Alice", [answer(towelSize, "Towel size", "Large")]),
      attendee("Gina", [answer(towelSize, "Towel size", "Small")]),
    ]);
    expect(same.columns.slice(columns.indexOf("Towel size"))).toEqual([
      "Towel size",
    ]);
    expect(same.rows.map((row) => row["Towel size"])).toEqual([
      "Large",
      "Small",
    ]);
  });

  it("gives answers to a question's earlier words a column of their own, after the others (AC-6)", () => {
    const { rows, columns } = read([
      attendee("Alice", [
        answer(heardOf, "Where did you hear of it?", "A friend"),
        answer(towelSize, "Towel size?", "Large"),
      ]),
      attendee("Gina", [answer(towelSize, "Towel size", "Small")]),
    ]);
    expect(columns.slice(-3)).toEqual([
      "Towel size",
      "Where did you hear of it?",
      "Towel size?",
    ]);
    expect(rows[0]?.["Towel size?"]).toBe("Large");
    expect(rows[1]?.["Towel size?"]).toBe("");
    expect(rows[0]?.["Towel size"]).toBe("");
  });
});
