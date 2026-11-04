import { Temporal } from "temporal-polyfill";
import type { EventRow } from "../api/SyncApi.ts";
import {
  type Cover,
  type DocumentId,
  type Organizer,
  type RichText,
  uniqueTags,
} from "../Model.ts";
import type { EventContent } from "./ContentTypes.ts";

/** What the event page shows: an event's published row without its publication. */
export type ShownEvent = Omit<
  EventRow,
  "publishedHeads" | "publishedAt" | "firstPublishedAt"
>;

/**
 * Automerge's immutable strings (and anything else that is not plain JSON)
 * made plain, all the way down: the way `automerge_spans` and
 * `automerge_to_jsonb` give them to `publish_event`.
 */
const plain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value !== "object" || value === null) return value;
  if (Object.getPrototypeOf(value) !== Object.prototype) return String(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, plain(entry)]),
  );
};

/** Trimmed as `publish_event` trims, with the same pattern; blank is none. */
const trimmedOrNull = (text: string | undefined): string | null => {
  const trimmed = (text ?? "").replace(/^\s+|\s+$/g, "");
  return trimmed === "" ? null : trimmed;
};

/** The moment of a time, as `zoned_instant` reads it. */
const instant = (time: string | null | undefined): Date | null =>
  time === null || time === undefined
    ? null
    : new Date(Temporal.ZonedDateTime.from(String(time)).epochMilliseconds);

/** The zone a time was set in, as `zoned_zone` reads it: "Europe/Oslo". */
const zoneOf = (time: string): string =>
  /\[([^\]]+)\]$/.exec(String(time))?.[1] ?? "";

/**
 * The event page for a draft, as publishing it now would make it (the newest
 * `publish_event` in server/migrations.ts): null while it has no start or
 * end, since the page is built around its times. `content` is the draft as
 * read from Automerge, with immutable strings where the editor keeps them;
 * `body` is its body's spans. Every rule below is `publish_event`'s, except
 * that a blank place is none: publishing refuses a draft without one.
 */
export const eventPreview = (draft: {
  readonly id: DocumentId;
  readonly content: EventContent;
  readonly body: RichText;
  readonly organizer: Organizer;
}): ShownEvent | null => {
  const { id, content, body, organizer } = draft;
  if (content.start === null || content.end === null) return null;
  const streamed = content.streamed ?? false;
  return {
    id,
    title: content.title,
    summary: trimmedOrNull(content.summary),
    startsAt: instant(content.start) ?? new Date(Number.NaN),
    endsAt: instant(content.end) ?? new Date(Number.NaN),
    signupDeadline: instant(content.deadline),
    timeZone: zoneOf(content.start),
    body: plain(body) as RichText,
    cover: content.cover === undefined ? null : (plain(content.cover) as Cover),
    organizer,
    isPublic: content.public,
    allowGuests: content.public && content.guests,
    askDietary: content.dietary,
    food: content.food,
    foodDeadline: instant(content.foodDeadline),
    questions: content.questions.map((question) => ({
      id: String(question.id),
      type: String(question.type) as "text" | "checkbox" | "choice",
      text: question.text,
      ...(question.label === undefined ? {} : { label: question.label }),
      required: question.required,
      options: question.options.map((option) => ({
        id: String(option.id),
        text: option.text,
      })),
    })),
    tags: uniqueTags(content.tags.map(String)),
    place: (content.place ?? "").trim() === "" ? null : (content.place ?? null),
    maxAttendees: content.maxAttendees ?? null,
    hidePlacesLeft: content.hidePlacesLeft ?? false,
    isStreamed: streamed,
    streamLink: streamed ? trimmedOrNull(content.streamLink) : null,
  };
};
