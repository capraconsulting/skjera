import type {
  AdSource,
  Answer,
  AttendeeRow,
  EventRow,
} from "@skjera/documents/api";
import { readSheet } from "read-excel-file/node";
import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import {
  adSourceText,
  attendeesSheet,
  xlsxInput,
} from "../src/routes/studio/attendeesSheet.ts";

const towelSize = "11111111-1111-4111-8111-111111111111";
const heardOf = "22222222-2222-4222-8222-222222222222";

type SheetEvent = Pick<
  EventRow,
  "title" | "questions" | "isStreamed" | "allowGuests" | "isSalesEvent"
>;

const event: SheetEvent = {
  title: "Summer party",
  isStreamed: false,
  allowGuests: false,
  isSalesEvent: false,
  questions: [
    {
      id: towelSize,
      type: "text",
      text: "Towel size",
      required: false,
      options: [],
    },
  ],
};

const answer = (id: string, question: string, text: string): Answer => ({
  id,
  question,
  answer: text,
  value: text,
});

const yes = (id: string, question: string): Answer => ({
  id,
  question,
  answer: "Yes",
  value: true,
});

const attendee = (
  name: string,
  answers: ReadonlyArray<Answer> = [],
  more: {
    readonly online?: boolean;
    readonly phone?: string;
    readonly company?: string;
    readonly source?: AdSource;
    readonly consent?: boolean;
  } = {},
): AttendeeRow => ({
  id: name,
  eventId: "33333333-3333-4333-8333-333333333333" as AttendeeRow["eventId"],
  signedUpAt: new Date("2026-10-20T08:15:00.000Z"),
  changedAt: new Date("2026-10-20T08:15:00.000Z"),
  mine: false,
  online: more.online ?? false,
  details: {
    name,
    email: `${name.toLowerCase()}@example.com`,
    phone: more.phone ?? null,
    company: more.company ?? null,
    source: more.source ?? null,
    consent: more.consent ?? false,
    answers,
    guest: false,
  },
});

/** The sheet built, with its rows read by column heading. */
const read = (
  attendees: ReadonlyArray<AttendeeRow>,
  given: SheetEvent = event,
) => {
  const sheet = attendeesSheet(given, attendees);
  return {
    sheet,
    columns: sheet.columns,
    rows: sheet.rows.map((row) =>
      Object.fromEntries(sheet.columns.map((name, at) => [name, row[at]])),
    ),
  };
};

describe("attendeesSheet", () => {
  it("is the sheet Sign-ups of the file <title>.xlsx (AC-7)", () => {
    const { sheet } = read([attendee("Alice")]);
    expect(sheet.name).toBe("Sign-ups");
    expect(sheet.fileName).toBe("Summer party.xlsx");
  });

  it("has Name, Email, then Phone and Company, Online and a column per question, for a streamed event open to guests (AC-7)", () => {
    const { columns, rows } = read(
      [
        attendee("Bob", [answer(towelSize, "Towel size", "Large")], {
          online: true,
        }),
        attendee("Gina", [], { phone: "+47 900 00 000", company: "Acme" }),
      ],
      { ...event, isStreamed: true, allowGuests: true },
    );
    expect(columns).toEqual([
      "Name",
      "Email",
      "Phone",
      "Company",
      "Online",
      "Towel size",
    ]);
    expect(rows[0]).toMatchObject({
      Name: "Bob",
      Email: "bob@example.com",
      Online: "Yes",
      "Towel size": "Large",
    });
    expect(rows[1]).toMatchObject({
      Name: "Gina",
      Phone: "+47 900 00 000",
      Company: "Acme",
      Online: "No",
    });
  });

  it("has only Name, Email and the questions for an event not open to guests and not streamed (AC-7)", () => {
    const { columns } = read([attendee("Alice")]);
    expect(columns).toEqual(["Name", "Email", "Towel size"]);
  });

  it("keeps the column of a question taken off the event, last (AC-7)", () => {
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

  it("heads a question's column with the words its answers were given to (AC-7)", () => {
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
    expect(same.columns).toEqual(["Name", "Email", "Towel size"]);
    expect(same.rows.map((row) => row["Towel size"])).toEqual([
      "Large",
      "Small",
    ]);
  });

  it("heads a checkbox question's column with its text, not its answer option (AC-5)", () => {
    const swim = "44444444-4444-4444-8444-444444444444";
    const { rows, columns } = read(
      [attendee("Gina", [yes(swim, "Skal du bade?")])],
      {
        ...event,
        questions: [
          {
            id: swim,
            type: "checkbox",
            text: "Skal du bade?",
            label: "Ja, jeg vil leie badebukse",
            required: false,
            options: [],
          },
        ],
      },
    );
    expect(columns).toEqual(["Name", "Email", "Skal du bade?"]);
    expect(rows[0]?.["Skal du bade?"]).toBe("Yes");
  });

  it("gives answers to a question's earlier words a column of their own, after the others (AC-7)", () => {
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

describe("an attendee's ad source", () => {
  it("has a column for each value any attendee has, after the others and before the questions, filled where there is one (AC-5)", () => {
    const { columns, rows } = read([
      attendee("Alice", [answer(towelSize, "Towel size", "Large")], {
        source: { utm_source: "linkedin", utm_campaign: "spring" },
      }),
      attendee("Bob"),
    ]);
    expect(columns).toEqual([
      "Name",
      "Email",
      "utm_source",
      "utm_campaign",
      "Towel size",
    ]);
    expect(rows[0]).toMatchObject({
      utm_source: "linkedin",
      utm_campaign: "spring",
    });
    expect(rows[1]).toMatchObject({ utm_source: "", utm_campaign: "" });
  });

  it("has no such column when no attendee has a source (AC-5)", () => {
    const { columns } = read([attendee("Alice"), attendee("Bob")]);
    expect(columns).toEqual(["Name", "Email", "Towel size"]);
  });

  it("reads as the values present, in the order of the names (AC-5)", () => {
    expect(
      adSourceText({ utm_campaign: "spring", utm_source: "linkedin" }),
    ).toBe("utm_source: linkedin, utm_campaign: spring");
  });
});

describe("an attendee's consent", () => {
  const heading = "Invitations and newsletter";
  const salesEvent = { ...event, isSalesEvent: true };

  it("has a column of Yes and No on a sales event, after the online column and before the questions (AC-4)", () => {
    const { columns, rows } = read(
      [attendee("Alice", [], { consent: true }), attendee("Bob")],
      { ...salesEvent, isStreamed: true },
    );
    expect(columns).toEqual(["Name", "Email", "Online", heading, "Towel size"]);
    expect(rows[0]?.[heading]).toBe("Yes");
    expect(rows[1]?.[heading]).toBe("No");
  });

  it("has no such column on an event that is not a sales event, when no one ticked (AC-4)", () => {
    const { columns } = read([attendee("Alice"), attendee("Bob")]);
    expect(columns).not.toContain(heading);
  });

  it("keeps the column once the event is no longer a sales event, where someone ticked (AC-4)", () => {
    const { columns, rows } = read([
      attendee("Alice", [], { consent: true }),
      attendee("Bob"),
    ]);
    expect(columns).toContain(heading);
    expect(rows.map((row) => row[heading])).toEqual(["Yes", "No"]);
  });
});

describe("xlsxInput", () => {
  it("writes an answer that starts like a formula as text, read back as the same text (AC-7)", async () => {
    const { sheet } = read([
      attendee("Alice", [answer(towelSize, "Towel size", "=1+1")]),
      attendee("Gina", [answer(towelSize, "Towel size", "007")]),
    ]);
    const input = xlsxInput(sheet);
    const file = await writeExcelFile(input.data, {
      sheet: input.sheet,
    }).toBuffer();
    const data = await readSheet(file);
    expect(data[0]).toEqual(["Name", "Email", "Towel size"]);
    expect(data[1]?.[2]).toBe("=1+1");
    expect(data[2]?.[2]).toBe("007");
  });
});
