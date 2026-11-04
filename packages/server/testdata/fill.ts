// Making the catalogue's teams and events through the services the studio and
// the site use, and removing them again.
import { crc32, deflateSync } from "node:zlib";
import * as A from "@automerge/automerge";
import {
  Attendance,
  type DocumentId,
  Documents,
  type EventContent,
  Images,
  type ReminderChoice,
  type SignupDetails,
  type TeamId,
  Teams,
} from "@skjera/documents";
import type { Identity } from "@skjera/oauth/api";
import { AwsClient } from "aws4fetch";
import { Config, Data, Effect, Redacted } from "effect";
import { SqlClient } from "effect/sql";
import type { Temporal } from "temporal-polyfill";

export type Colour =
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "purple"
  | "orange"
  | "teal"
  | "pink";

const rgb: Record<Colour, readonly [number, number, number]> = {
  red: [220, 53, 69],
  green: [40, 167, 69],
  blue: [13, 110, 253],
  yellow: [255, 193, 7],
  purple: [111, 66, 193],
  orange: [253, 126, 20],
  teal: [32, 201, 151],
  pink: [214, 51, 132],
};

export interface QuestionSpec {
  /** What answers are given under. */
  readonly key: string;
  readonly type: "text" | "checkbox" | "choice";
  readonly text: string;
  readonly required?: boolean;
  /** For a choice: the texts of its options. */
  readonly options?: ReadonlyArray<string>;
}

/** A block of an event's text, as the editor writes one. */
export type Block =
  | { readonly kind: "heading"; readonly text: string }
  | {
      readonly kind: "paragraph";
      readonly text: string;
      /** A word of the text, in bold. */
      readonly bold?: string;
      /** A part of the text, linked. */
      readonly link?: { readonly text: string; readonly href: string };
    }
  | { readonly kind: "item"; readonly text: string };

export interface SignupSpec {
  readonly who: "bob" | "guest";
  /** A guest's own name and email, which is what they are known by. */
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly company?: string;
  /** By question key; a choice is answered with the text of its option. */
  readonly answers?: Readonly<Record<string, string | boolean>>;
  /** What they can't eat. */
  readonly dietary?: string;
  /** Follows online rather than in person. */
  readonly online?: boolean;
}

export type EmailKind =
  | "signedUp"
  | "signupCancelled"
  | "eventChanged"
  | "eventCancelled";

export interface EventSpec {
  readonly title: string;
  /**
   * published (the default); draft, written and never published; titled, a
   * draft with only its title; empty, nothing written; deleted, published and
   * then deleted.
   */
  readonly state?: "published" | "draft" | "titled" | "empty" | "deleted";
  readonly start?: Temporal.ZonedDateTime;
  readonly end?: Temporal.ZonedDateTime;
  readonly deadline?: Temporal.ZonedDateTime;
  readonly foodDeadline?: Temporal.ZonedDateTime;
  readonly public?: boolean;
  readonly guests?: boolean;
  readonly place?: string;
  readonly summary?: string;
  readonly body?: ReadonlyArray<Block>;
  readonly cover?: Colour;
  /** Food is served. */
  readonly dietary?: boolean;
  /** What is served. */
  readonly food?: string;
  readonly maxAttendees?: number;
  readonly hidePlacesLeft?: boolean;
  readonly streamed?: boolean;
  readonly streamLink?: string;
  readonly questions?: ReadonlyArray<QuestionSpec>;
  readonly tags?: ReadonlyArray<string>;
  /** Remind attendees: "off" unless the file asks for it. */
  readonly remind?: ReminderChoice;
  readonly emails?: Partial<
    Record<EmailKind, { readonly subject?: string; readonly text?: string }>
  >;
  readonly repeat?: {
    readonly every: number;
    readonly unit: "day" | "week" | "month" | "year";
  };
  readonly signups?: ReadonlyArray<SignupSpec>;
  /** After the event is published, bob gives the draft another summary. */
  readonly edit?: { readonly summary: string };
}

export interface TeamSpec {
  readonly name: string;
  readonly logo?: Colour;
  readonly logoDark?: Colour;
  /**
   * A team of this name may exist already, made by hand: its events stay, and
   * only those of the catalogue come and go. The team itself is the command's
   * when it has this id, and goes when nothing else is left in it.
   */
  readonly sharedId?: string;
  readonly events: ReadonlyArray<EventSpec>;
}

export interface People {
  readonly alice: Identity;
  readonly bob: Identity;
}

/** What was done: the teams removed, the teams made, and the events deleted. */
export interface Report {
  readonly removed: ReadonlyArray<string>;
  readonly made: ReadonlyArray<{
    readonly team: string;
    readonly events: number;
  }>;
  readonly deleted: ReadonlyArray<{
    readonly team: string;
    readonly event: string;
    readonly id: string;
  }>;
}

/** Skjera refused something the catalogue asked for: its own reason is in it. */
export class TestDataRefused extends Data.TaggedError("TestDataRefused")<{
  readonly team: string;
  readonly event: string;
  /** The tag of Skjera's problem, such as GuestsNotAllowed. */
  readonly reason: string;
  readonly detail: string;
}> {
  override get message() {
    const where =
      this.event === "" ? this.team : `${this.team} / ${this.event}`;
    return `${where}: ${this.reason}: ${this.detail}`;
  }
}

const refusal =
  (team: string, event: string) =>
  (error: {
    readonly _tag: string;
    readonly message: string;
    readonly problem?: { readonly _tag: string };
  }) =>
    new TestDataRefused({
      team,
      event,
      reason: error.problem?._tag ?? error._tag,
      detail: error.message,
    });

// ---- Images ----------------------------------------------------------------

const chunk = (type: string, data: Uint8Array) => {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

/** A 64×64 PNG of one colour, so logos and covers can be told apart. */
export const colouredPng = (colour: Colour): Uint8Array => {
  const size = 64;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, no interlace
  const row = Buffer.alloc(1 + size * 3); // filter type 0, then the pixels
  for (let x = 0; x < size; x++) row.set(rgb[colour], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// ---- Writing a draft as the editor does ------------------------------------

type Draft = Record<string, unknown>;

/** A time as the editor sets it: replaced as a whole. */
const time = (value: Temporal.ZonedDateTime | undefined) =>
  value === undefined
    ? null
    : new A.ImmutableString(value.toString({ smallestUnit: "minute" }));

/** Text under a key that older drafts lack, created when missing. */
const setText = (doc: EventContent, key: string, text: string) => {
  const draft = doc as unknown as Draft;
  if (draft[key] === undefined) draft[key] = "";
  A.updateText(doc, [key], text);
};

/** Rich text: a block marker, then its text, block after block. */
const setRichText = (
  doc: EventContent,
  key: string,
  blocks: ReadonlyArray<Block>,
) => {
  const draft = doc as unknown as Draft;
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

const emailKeys = {
  signedUp: ["signedUpSubject", "signedUpText"],
  signupCancelled: ["signupCancelledSubject", "signupCancelledText"],
  eventChanged: ["eventChangedSubject", "eventChangedText"],
  eventCancelled: ["eventCancelledSubject", "eventCancelledText"],
} as const;

/** The ids the draft's questions and their options were given. */
interface Ids {
  readonly questions: Map<string, string>;
  readonly options: Map<string, string>;
}

const writeTitle = (doc: EventContent, spec: EventSpec) => {
  A.updateText(doc, ["title"], spec.title);
};

const writeEvent = (
  doc: EventContent,
  spec: EventSpec,
  ids: Ids,
  cover: string | undefined,
) => {
  const draft = doc as unknown as Draft;
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
  for (const tag of spec.tags ?? []) (draft.tags as Array<string>).push(tag);
  for (const [kind, email] of Object.entries(spec.emails ?? {}) as Array<
    [EmailKind, { subject?: string; text?: string }]
  >) {
    const [subject, text] = emailKeys[kind];
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

// ---- Removing --------------------------------------------------------------

/** Deletes stored images by their addresses (`/api/images/<id>`). */
const deleteImages = (sources: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (sources.length === 0) return;
    const endpoint = yield* Config.URL("S3_ENDPOINT");
    const bucket = yield* Config.String("S3_BUCKET");
    const client = new AwsClient({
      accessKeyId: yield* Config.String("S3_ACCESS_KEY_ID"),
      secretAccessKey: Redacted.value(
        yield* Config.Redacted("S3_SECRET_ACCESS_KEY"),
      ),
      region: yield* Config.String("S3_REGION").pipe(
        Config.withDefault("us-east-1"),
      ),
      service: "s3",
    });
    for (const source of sources) {
      const id = source.split("/").pop() ?? "";
      const url = new URL(`${bucket}/${id}`, endpoint.href.replace(/\/?$/, "/"))
        .href;
      const response = yield* Effect.promise(() =>
        client.fetch(url, { method: "DELETE" }),
      );
      if (!response.ok && response.status !== 404)
        yield* Effect.die(
          new Error(`Deleting image failed: ${response.status}`),
        );
    }
  });

/**
 * Removes every team of the catalogue, whoever made it, with its documents,
 * and what goes with them: events, signups, dietary preferences, the actors
 * of the drafts, the images they show, unless a team, event or draft that is
 * left shows them too, and the tags only they used. In a shared team only the
 * catalogue's events go, and the team itself when the command made it and
 * nothing else is left. Tells nobody. Returns the teams removed.
 */
export const clear = (teams: ReadonlyArray<TeamSpec>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const removed: Array<string> = [];
    const images = new Set<string>();
    const unused = yield* Effect.gen(function* () {
      for (const team of teams) {
        const [found] = yield* sql<{ id: string }>`
          SELECT id FROM teams WHERE lower(name) = lower(${team.name})`;
        if (found === undefined) continue;
        // An empty array can't be sent as a parameter.
        const titles = team.events.map((event) => event.title).concat("\u0001");
        const shared = team.sharedId !== undefined;
        const pictures = yield* sql<{ src: string | null }>`
          SELECT src FROM (
            SELECT logo AS src FROM teams WHERE id = ${found.id} AND NOT ${shared}::boolean
            UNION ALL
            SELECT logo_dark FROM teams WHERE id = ${found.id} AND NOT ${shared}::boolean
            UNION ALL
            SELECT e.cover->>'src' FROM events e JOIN documents d ON d.id = e.id
              WHERE d.team_id = ${found.id} AND (NOT ${shared}::boolean OR d.title = ANY(${titles}::text[]))
            UNION ALL
            SELECT d.draft::jsonb->'cover'->>'src' FROM documents d
              WHERE d.team_id = ${found.id} AND (NOT ${shared}::boolean OR d.title = ANY(${titles}::text[]))
          ) pictures WHERE src IS NOT NULL`;
        for (const { src } of pictures) if (src !== null) images.add(src);
        if (!shared) {
          yield* sql`DELETE FROM documents WHERE team_id = ${found.id}`;
        } else {
          yield* sql`
            DELETE FROM documents
            WHERE team_id = ${found.id} AND title = ANY(${titles}::text[])`;
          if (found.id !== team.sharedId) continue;
          const left = yield* sql`
            SELECT 1 FROM documents WHERE team_id = ${found.id} LIMIT 1`;
          if (left.length > 0) continue;
        }
        yield* sql`DELETE FROM teams WHERE id = ${found.id}`;
        removed.push(team.name);
      }
      // Tags the catalogue added, unless a remaining event still has them.
      const tags = [
        ...new Set(
          teams.flatMap((team) => team.events.flatMap((e) => e.tags ?? [])),
        ),
      ];
      if (tags.length > 0)
        yield* sql`
        DELETE FROM tags
        WHERE lower(name) = ANY(${tags.map((tag) => tag.toLowerCase())}::text[])
          AND NOT EXISTS (
            SELECT 1 FROM events e, unnest(e.tags) AS used
            WHERE lower(used) = lower(tags.name))`;
      // The images nothing left shows. A draft's rich texts are read as
      // publishing reads them: `draft::jsonb` leaves out their image blocks.
      // An empty array can't be sent as a parameter.
      if (images.size === 0) return [] as ReadonlyArray<string>;
      const free = yield* sql<{ src: string }>`
        SELECT src FROM unnest(${[...images]}::text[]) AS src
        WHERE NOT EXISTS (
            SELECT 1 FROM teams WHERE logo = src OR logo_dark = src)
          AND NOT EXISTS (
            SELECT 1 FROM events e WHERE strpos(to_jsonb(e)::text, src) > 0)
          AND NOT EXISTS (
            SELECT 1 FROM documents d
            CROSS JOIN LATERAL (
              SELECT automerge_heads(d.draft) AS heads, d.draft::jsonb AS content
            ) h
            WHERE d.type = 'event' AND strpos(concat_ws(' ',
              h.content::text,
              automerge_spans(d.draft, '{body}', h.heads)::text,
              email_text_spans(d.draft, 'signedUpText', h.heads, h.content)::text,
              email_text_spans(d.draft, 'signupCancelledText', h.heads, h.content)::text,
              email_text_spans(d.draft, 'eventChangedText', h.heads, h.content)::text,
              email_text_spans(d.draft, 'eventCancelledText', h.heads, h.content)::text
            ), src) > 0)`;
      return free.map(({ src }) => src);
    }).pipe(sql.withTransaction, Effect.orDie);
    yield* deleteImages(unused);
    return removed as ReadonlyArray<string>;
  });

// ---- Making ----------------------------------------------------------------

/**
 * Removes what an earlier run made, then makes every team, event and signup
 * of the catalogue, as alice and bob. Skjera's own refusals end the run.
 */
export const fill = (teams: ReadonlyArray<TeamSpec>, people: People) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const teamService = yield* Teams;
    const documents = yield* Documents;
    const attendance = yield* Attendance;
    const images = yield* Images.Images;

    const removed = yield* clear(teams);
    const uploaded = new Map<Colour, string>();
    const upload = (team: string, colour: Colour) =>
      Effect.gen(function* () {
        const known = uploaded.get(colour);
        if (known !== undefined) return known;
        const image = yield* images
          .upload(colouredPng(colour))
          .pipe(Effect.mapError(refusal(team, "")));
        uploaded.set(colour, image.url);
        return image.url;
      });

    const signUp = (team: string, spec: EventSpec, id: DocumentId, ids: Ids) =>
      Effect.forEach(
        spec.signups ?? [],
        (signup) => {
          const answers: Record<string, string | boolean> = {};
          for (const [key, value] of Object.entries(signup.answers ?? {})) {
            const question = ids.questions.get(key);
            if (question === undefined) continue;
            answers[question] =
              typeof value === "string"
                ? (ids.options.get(`${key}/${value}`) ?? value)
                : value;
          }
          const details: SignupDetails = {
            answers,
            ...(signup.dietary === undefined
              ? {}
              : { dietary: signup.dietary }),
            ...(signup.online === undefined ? {} : { online: signup.online }),
          };
          const attending =
            signup.who === "bob"
              ? attendance.attend(id, people.bob, details)
              : attendance.attendAsGuest(
                  id,
                  {
                    name: signup.name ?? "Guest",
                    email: signup.email ?? "",
                    ...(signup.phone === undefined
                      ? {}
                      : { phone: signup.phone }),
                    ...(signup.company === undefined
                      ? {}
                      : { company: signup.company }),
                  },
                  details,
                );
          return attending.pipe(Effect.mapError(refusal(team, spec.title)));
        },
        { discard: true },
      );

    const makeEvent = (team: string, teamId: TeamId, spec: EventSpec) =>
      Effect.gen(function* () {
        const state = spec.state ?? "published";
        const refuse = refusal(team, spec.title);
        const id = yield* documents
          .create("event", teamId, people.alice)
          .pipe(Effect.mapError(refuse));
        if (state === "empty") return undefined;

        const ids: Ids = { questions: new Map(), options: new Map() };
        const cover =
          spec.cover === undefined
            ? undefined
            : yield* upload(team, spec.cover);
        const snapshot = yield* documents.get(id).pipe(Effect.mapError(refuse));
        const edited = A.change(A.load<EventContent>(snapshot.draft), (doc) => {
          if (state === "titled") writeTitle(doc, spec);
          else writeEvent(doc, spec, ids, cover);
        });
        const change = A.getLastLocalChange(edited);
        if (change === undefined) return undefined;
        const heads = yield* documents
          .applyChanges(id, [change], people.alice)
          .pipe(Effect.mapError(refuse));

        if (state !== "published" && state !== "deleted") return undefined;
        yield* documents
          .publish(id, heads, people.alice)
          .pipe(Effect.mapError(refuse));
        yield* signUp(team, spec, id, ids);
        const edit = spec.edit;
        if (edit !== undefined) {
          const published = yield* documents
            .get(id)
            .pipe(Effect.mapError(refuse));
          const changed = A.change(
            A.load<EventContent>(published.draft),
            (doc) => setText(doc, "summary", edit.summary),
          );
          const edited = A.getLastLocalChange(changed);
          if (edited !== undefined) {
            yield* documents
              .applyChanges(id, [edited], people.bob)
              .pipe(Effect.mapError(refuse));
          }
        }
        if (state !== "deleted") return undefined;
        yield* documents.delete(id, people.alice).pipe(Effect.mapError(refuse));
        return id as string;
      });

    const made: Array<{ team: string; events: number }> = [];
    const deleted: Array<{ team: string; event: string; id: string }> = [];
    for (const spec of teams) {
      const refuse = refusal(spec.name, "");
      const [existing] =
        spec.sharedId === undefined
          ? []
          : yield* sql<{ id: TeamId }>`
              SELECT id FROM teams WHERE lower(name) = lower(${spec.name})`.pipe(
              Effect.orDie,
            );
      const teamId =
        existing?.id ??
        (yield* teamService
          .create(spec.name, people.alice, spec.sharedId as TeamId | undefined)
          .pipe(Effect.mapError(refuse))).id;
      if (spec.logo !== undefined || spec.logoDark !== undefined) {
        const logo =
          spec.logo === undefined ? null : yield* upload(spec.name, spec.logo);
        const logoDark =
          spec.logoDark === undefined
            ? null
            : yield* upload(spec.name, spec.logoDark);
        yield* teamService
          .setLogos(teamId, { logo, logoDark })
          .pipe(Effect.mapError(refuse));
      }
      for (const event of spec.events) {
        const id = yield* makeEvent(spec.name, teamId, event);
        if (id !== undefined)
          deleted.push({ team: spec.name, event: event.title, id });
      }
      made.push({ team: spec.name, events: spec.events.length });
    }
    return { removed, made, deleted } satisfies Report;
  });
