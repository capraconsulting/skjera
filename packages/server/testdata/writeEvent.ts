import * as A from "@automerge/automerge";
import type { EmailKind, EventContent } from "@skjera/documents";
import { organizerEmails } from "@skjera/documents";
import type { Temporal } from "temporal-polyfill";
import type { Block, EventSpec } from "./fill.ts";

// ---- Writing a draft as the editor does ------------------------------------

type TextField = {
  [Field in keyof EventContent]-?: Exclude<
    EventContent[Field],
    undefined
  > extends string
    ? Field
    : never;
}[keyof EventContent];
type Draft = {
  -readonly [Field in keyof EventContent]: Field extends "tags"
    ? Array<string>
    : unknown;
};

/** A time as the editor sets it: replaced as a whole. */
const time = (value: Temporal.ZonedDateTime | undefined) =>
  value === undefined
    ? null
    : new A.ImmutableString(value.toString({ smallestUnit: "minute" }));

/** Text under a key that older drafts lack, created when missing. */
export const setText = (doc: EventContent, key: TextField, text: string) => {
  const draft = doc as Draft;
  if (draft[key] === undefined) draft[key] = "";
  A.updateText(doc, [key], text);
};

/** Rich text: a block marker, then its text, block after block. */
export const setRichText = (
  doc: EventContent,
  key: TextField,
  blocks: ReadonlyArray<Block>,
) => {
  const draft = doc as Draft;
  if (draft[key] === undefined) draft[key] = "";
  const marks: Array<{
    readonly start: number;
    readonly end: number;
    readonly name: string;
    readonly value: string | boolean;
  }> = [];
  let index = 0;
  for (const block of blocks) {
    const [type, attrs] =
      block.kind === "heading"
        ? (["heading", { level: 2 }] as const)
        : block.kind === "item"
          ? (["unordered-list-item", {}] as const)
          : (["paragraph", {}] as const);
    A.splitBlock(doc, [key], index, {
      type: new A.ImmutableString(type),
      parents: [],
      attrs,
    });
    index += 1;
    A.splice(doc, [key], index, 0, block.text);
    if (block.kind === "paragraph") {
      const bold =
        block.bold === undefined ? -1 : block.text.indexOf(block.bold);
      if (block.bold !== undefined && bold >= 0)
        marks.push({
          start: index + bold,
          end: index + bold + block.bold.length,
          name: "strong",
          value: true,
        });
      const link =
        block.link === undefined ? -1 : block.text.indexOf(block.link.text);
      if (block.link !== undefined && link >= 0)
        marks.push({
          start: index + link,
          end: index + link + block.link.text.length,
          name: "link",
          value: JSON.stringify({ href: block.link.href, title: "" }),
        });
    }
    index += block.text.length;
  }
  for (const mark of marks)
    A.mark(
      doc,
      [key],
      { start: mark.start, end: mark.end, expand: "none" },
      mark.name,
      mark.value,
    );
};

/** The ids the draft's questions and their options were given. */
export interface Ids {
  readonly questions: Map<string, string>;
  readonly options: Map<string, string>;
}

export const writeTitle = (doc: EventContent, spec: EventSpec) => {
  A.updateText(doc, ["title"], spec.title);
};

export const writeEvent = (
  doc: EventContent,
  spec: EventSpec,
  ids: Ids,
  cover: string | undefined,
) => {
  const draft = doc as Draft;
  writeTitle(doc, spec);
  if (spec.summary !== undefined) setText(doc, "summary", spec.summary);
  if (spec.place !== undefined) setText(doc, "place", spec.place);
  if (spec.body !== undefined) setRichText(doc, "body", spec.body);
  if (spec.cover !== undefined && cover !== undefined)
    draft.cover = { src: new A.ImmutableString(cover), alt: "" };
  draft.start = time(spec.start);
  draft.end = time(spec.end);
  draft.deadline = time(spec.deadline);
  draft.foodDeadline = time(spec.foodDeadline);
  draft.public = spec.public ?? false;
  draft.guests = spec.guests ?? false;
  draft.dietary = spec.dietary ?? false;
  draft.reminders = new A.ImmutableString(spec.remind ?? "off");
  if (spec.food !== undefined) setText(doc, "food", spec.food);
  if (spec.maxAttendees !== undefined) draft.maxAttendees = spec.maxAttendees;
  if (spec.hidePlacesLeft !== undefined)
    draft.hidePlacesLeft = spec.hidePlacesLeft;
  if (spec.streamed !== undefined) draft.streamed = spec.streamed;
  if (spec.streamLink !== undefined)
    setText(doc, "streamLink", spec.streamLink);
  if (spec.salesEvent !== undefined) draft.salesEvent = spec.salesEvent;
  if (spec.salesEventType !== undefined)
    setText(doc, "salesEventType", spec.salesEventType);
  if (spec.questions !== undefined)
    draft.questions = spec.questions.map((question) => {
      const id = crypto.randomUUID();
      ids.questions.set(question.key, id);
      return {
        id: new A.ImmutableString(id),
        type: new A.ImmutableString(question.type),
        text: question.text,
        required: question.required ?? false,
        options: (question.options ?? []).map((text) => {
          const option = crypto.randomUUID();
          ids.options.set(`${question.key}/${text}`, option);
          return { id: new A.ImmutableString(option), text };
        }),
      };
    });
  for (const tag of spec.tags ?? []) draft.tags.push(tag);
  for (const [kind, email] of Object.entries(spec.emails ?? {}) as Array<
    [EmailKind, { subject?: string; text?: string }]
  >) {
    const { subject, text } = organizerEmails.find(
      (candidate) => candidate.kind === kind,
    ) as (typeof organizerEmails)[number];
    if (email.subject !== undefined) setText(doc, subject, email.subject);
    if (email.text !== undefined)
      setRichText(doc, text, [{ kind: "paragraph", text: email.text }]);
  }
  if (spec.repeat !== undefined) {
    draft.recurring = true;
    draft.repeatEvery = spec.repeat.every;
    draft.repeatUnit = new A.ImmutableString(spec.repeat.unit);
  }
};
