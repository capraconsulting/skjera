import {
  type AdSource,
  type Answer,
  type AttendeeRow,
  adSourceKeys,
  type EventRow,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";

/** A column: a question, by its id, in the words its answers were given to. */
const column = (id: string, words: string) => JSON.stringify([id, words]);

/** The attendees as a sheet: its name, the file's, its headings and its rows. */
export interface Sheet {
  readonly name: string;
  readonly fileName: string;
  readonly columns: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

/**
 * The attendees as a spreadsheet: who they are, a guest's phone number and
 * company where guests can sign up, how each attends when the event is
 * streamed, whether each asked for invitations and the newsletter where the
 * event is a sales event or any of them did, a column for each value of the
 * ad they came from that any of
 * them has, headed with its name, and a column for each question, headed
 * with the words its answers were given to. Answers given to a question's earlier words, and to
 * questions taken off the event since, still show, after the others, each
 * under the words it was asked in.
 */
export const attendeesSheet = (
  event:
    | Pick<
        EventRow,
        "title" | "questions" | "isStreamed" | "allowGuests" | "isSalesEvent"
      >
    | undefined,
  attendees: ReadonlyArray<AttendeeRow>,
): Sheet => {
  const questions = new Map<string, string>(
    (event?.questions ?? []).map((question) => [
      column(question.id, question.text),
      question.text,
    ]),
  );
  for (const attendee of attendees) {
    for (const answer of attendee.details?.answers ?? []) {
      const key = column(answer.id, answer.question);
      if (!questions.has(key)) questions.set(key, answer.question);
    }
  }
  const sources = adSourceKeys.filter((name) =>
    attendees.some(
      (attendee) => attendee.details?.source?.[name] !== undefined,
    ),
  );
  const streamed = event?.isStreamed === true;
  const guests = event?.allowGuests === true;
  const consents =
    event?.isSalesEvent === true ||
    attendees.some((attendee) => attendee.details?.consent === true);
  const rows = attendees.flatMap(({ details, online }) => {
    if (details === null) return [];
    const answers = new Map(
      details.answers.map((answer) => [
        column(answer.id, answer.question),
        answerText(answer),
      ]),
    );
    return [
      [
        details.name,
        details.email ?? "",
        ...(guests ? [details.phone ?? "", details.company ?? ""] : []),
        ...(streamed ? [online ? m.common_yes() : m.common_no()] : []),
        ...(consents ? [details.consent ? m.common_yes() : m.common_no()] : []),
        ...sources.map((name) => details.source?.[name] ?? ""),
        ...[...questions.keys()].map((key) => answers.get(key) ?? ""),
      ],
    ];
  });
  return {
    name: m.studio_attendees_sheet(),
    fileName: `${event?.title.trim() || m.studio_event()}.xlsx`,
    columns: [
      m.sheet_name(),
      m.sheet_email(),
      ...(guests ? [m.sheet_phone(), m.sheet_company()] : []),
      ...(streamed ? [m.sheet_online()] : []),
      ...(consents ? [m.sheet_consent()] : []),
      ...sources,
      ...questions.values(),
    ],
    rows,
  };
};

/**
 * What `write-excel-file` is given for `sheet`: every cell typed as text, so
 * what people typed stays text (an answer like «=1+1» is never run), and an
 * empty one is an empty cell.
 */
export const xlsxInput = (sheet: Sheet) => ({
  data: [sheet.columns, ...sheet.rows].map((row) =>
    row.map((text) => (text === "" ? null : { value: text, type: String })),
  ),
  sheet: sheet.name,
});

/** The sheet as an .xlsx file: the writer is loaded when it is first needed. */
export const xlsxFile = async (sheet: Sheet): Promise<Blob> => {
  const { default: writeExcelFile } = await import("write-excel-file/browser");
  const input = xlsxInput(sheet);
  return writeExcelFile(input.data, { sheet: input.sheet }).toBlob();
};

/**
 * The ad someone came from as it reads: the values it has, in the order of
 * `adSourceKeys`, each as its name and value.
 */
export const adSourceText = (source: AdSource) =>
  adSourceKeys
    .flatMap((name) => {
      const value = source[name];
      return value === undefined ? [] : [`${name}: ${value}`];
    })
    .join(", ");

/** An answer as it reads: a ticked box as yes or no, in the interface's language. */
export const answerText = (answer: Answer) =>
  typeof answer.value === "boolean"
    ? answer.value
      ? m.common_yes()
      : m.common_no()
    : answer.answer;

/** Has the browser save `file` under `name`. */
export const download = (file: Blob, name: string) => {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
