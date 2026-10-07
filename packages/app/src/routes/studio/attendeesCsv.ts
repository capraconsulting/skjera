import type { AttendeeRow, EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import Papa from "papaparse";

/**
 * The attendees as a spreadsheet: who they are, what they can't eat, and a
 * column for each question. Questions taken off the event since still
 * show, after the others, as they were asked.
 */
export const attendeesCsv = (
  event: Pick<EventRow, "questions"> | undefined,
  attendees: ReadonlyArray<AttendeeRow>,
): string => {
  const columns = new Map<string, string>(
    (event?.questions ?? []).map((question) => [question.id, question.text]),
  );
  for (const attendee of attendees) {
    for (const answer of attendee.details?.answers ?? []) {
      if (!columns.has(answer.id)) columns.set(answer.id, answer.question);
    }
  }
  const rows = attendees.flatMap(({ details, signedUpAt, changedAt }) => {
    if (details === null) return [];
    const answers = new Map(
      details.answers.map((answer) => [answer.id, answer.answer]),
    );
    return [
      [
        details.name,
        details.email ?? "",
        details.guest ? m.common_yes() : m.common_no(),
        signedUpAt.toISOString(),
        changedAt.toISOString(),
        details.dietary ?? "",
        ...[...columns.keys()].map((id) => answers.get(id) ?? ""),
      ],
    ];
  });
  return Papa.unparse(
    {
      fields: [
        m.csv_name(),
        m.csv_email(),
        m.csv_guest(),
        m.csv_signed_up(),
        m.csv_changed(),
        m.csv_dietary(),
        ...columns.values(),
      ],
      data: rows,
    },
    // Answers are what people typed: spreadsheets mustn't run them.
    { escapeFormulae: true },
  );
};

/** Has the browser save `text` as a file. */
export const download = (text: string, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
