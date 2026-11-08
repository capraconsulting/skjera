import * as A from "@automerge/automerge";
import {
  Attendance,
  type DocumentId,
  Documents,
  type EmailKind,
  type EventContent,
  Images,
  organizerEmails,
  type ReminderChoice,
  type SignupDetails,
  type TeamId,
  Teams,
} from "@skjera/documents";
import type { Identity } from "@skjera/oauth/api";
import { Data, Effect } from "effect";
import { SqlClient } from "effect/sql";
import type { Temporal } from "temporal-polyfill";

export { type Colour, colouredPng } from "./images.ts";

import { type Colour, colouredPng } from "./images.ts";

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

export interface EventSpec {
  readonly title: string;
  /**
   * published (the default); draft, written and never published; titled, a
   * draft with only its title and its text; empty, nothing written; deleted,
   * published and then deleted.
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
  /** Sent to HubSpot as a sales event, with the type it is sent as. */
  readonly salesEvent?: boolean;
  readonly salesEventType?: string;
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

import {
  type Ids,
  setRichText,
  setText,
  writeEvent,
  writeTitle,
} from "./writeEvent.ts";

// ---- Removing --------------------------------------------------------------

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
    const imageService = yield* Images.Images;
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
              (SELECT string_agg(
                email_text_spans(d.draft, field, h.heads, h.content)::text,
                ' '
              ) FROM unnest(${organizerEmails.map(({ text }) => text)}::text[]) AS field)
            ), src) > 0)`;
      return free.map(({ src }) => src);
    }).pipe(sql.withTransaction, Effect.orDie);
    for (const source of unused)
      yield* imageService.delete(source.split("/").pop() ?? "");
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
          if (state === "titled") {
            writeTitle(doc, spec);
            if (spec.body !== undefined) setRichText(doc, "body", spec.body);
          } else writeEvent(doc, spec, ids, cover);
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
