import type { Answer, AttendeeRow, EventRow } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import Papa from "papaparse";

/**
 * The attendees as a spreadsheet: who they are, how each attends when the
 * event is streamed, what they can't eat, a guest's phone number and company,
 * and a column for each question. Questions taken off the event since still
 * show, after the others, as they were asked.
 */
export const attendeesCsv = (
  event: Pick<EventRow, "questions" | "isStreamed"> | undefined,
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
  const streamed = event?.isStreamed === true;
  const rows = attendees.flatMap(
    ({ details, online, signedUpAt, changedAt }) => {
      if (details === null) return [];
      const answers = new Map(
        details.answers.map((answer) => [answer.id, answerText(answer)]),
      );
      return [
        [
          details.name,
          details.email ?? "",
          details.guest ? m.common_yes() : m.common_no(),
          ...(streamed
            ? [online ? m.attend_online() : m.attend_in_person()]
            : []),
          signedUpAt.toISOString(),
          changedAt.toISOString(),
          details.dietary ?? "",
          details.phone ?? "",
          details.company ?? "",
          ...[...columns.keys()].map((id) => answers.get(id) ?? ""),
        ],
      ];
    },
  );
  return Papa.unparse(
    {
      fields: [
        m.csv_name(),
        m.csv_email(),
        m.csv_guest(),
        ...(streamed ? [m.csv_attending()] : []),
        m.csv_signed_up(),
        m.csv_changed(),
        m.csv_dietary(),
        m.csv_phone(),
        m.csv_company(),
        ...columns.values(),
      ],
      data: rows,
    },
    // Answers are what people typed: spreadsheets mustn't run them.
    { escapeFormulae: true },
  );
};

/** An answer as it reads: a ticked box as yes or no, in the interface's language. */
export const answerText = (answer: Answer) =>
  typeof answer.value === "boolean"
    ? answer.value
      ? m.common_yes()
      : m.common_no()
    : answer.answer;

/** Has the browser save `text` as a file. */
export const download = (text: string, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
