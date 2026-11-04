import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import type { EventContent } from "../../src/events/ContentTypes.ts";
import { Documents } from "../../src/events/Documents.ts";
import { eventPreview } from "../../src/events/Preview.ts";
import type { DocumentId, Organizer, RichText } from "../../src/Model.ts";
import {
  addTags,
  alice,
  end,
  newTeam,
  openEditor,
  publishedAs,
  setCover,
  setLimit,
  setPlace,
  setQuestions,
  setStreamed,
  setSummary,
  setTimes,
  start,
  TestLayer,
} from "../helpers.ts";

const organizer: Organizer = { name: "Team", logo: null, logoDark: null };

/** The preview of the draft an editor holds, as the app computes it. */
const previewOf = (
  id: DocumentId,
  editor: { readonly doc: () => EventContent },
  team: Organizer = organizer,
) =>
  eventPreview({
    id,
    content: editor.doc(),
    body: A.spans(editor.doc(), ["body"]) as unknown as RichText,
    organizer: team,
  });

/** A new draft, edited the way the studio does, and its editor. */
const draftWith = (edit: (event: EventContent) => void) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const id = yield* documents.create("event", yield* newTeam, alice);
    const editor = yield* openEditor(id);
    const heads = yield* documents.applyChanges(id, [editor.edit(edit)], alice);
    return { id, editor, heads };
  });

/**
 * What publishing the draft gives, and what the preview gives for it, the
 * publication itself left out.
 */
const publishedAndPreviewed = (edit: (event: EventContent) => void) =>
  Effect.gen(function* () {
    const documents = yield* Documents;
    const { id, editor, heads } = yield* draftWith(edit);
    yield* documents.publish(id, heads, alice);
    const published = yield* publishedAs(id, "members");
    if (published === undefined) return assert.fail("not published");
    const {
      publishedHeads: _heads,
      publishedAt: _at,
      firstPublishedAt: _first,
      ...page
    } = published;
    return { page, preview: previewOf(id, editor, published.organizer) };
  });

const setFormattedBody = (event: EventContent) => {
  // A heading, a list item, and a paragraph with a bold word.
  A.splitBlock(event, ["body"], 0, {
    type: new A.ImmutableString("heading"),
    parents: [],
    attrs: { level: 2 },
  });
  A.splice(event, ["body"], 1, 0, "News");
  A.splitBlock(event, ["body"], 5, {
    type: new A.ImmutableString("unordered-list-item"),
    parents: [],
    attrs: {},
  });
  A.splice(event, ["body"], 6, 0, "Bring a friend");
  A.splitBlock(event, ["body"], 20, {
    type: new A.ImmutableString("paragraph"),
    parents: [],
    attrs: {},
  });
  A.splice(event, ["body"], 21, 0, "We're live");
  A.mark(
    event,
    ["body"],
    { start: 27, end: 31, expand: "none" },
    "strong",
    true,
  );
};

const question = "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a01";
const choiceA = "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a02";
const choiceB = "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a03";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Event preview", (it) => {
  it.effect(
    "gives the row publishing gives, for a draft with every field set (AC-2)",
    () =>
      Effect.gen(function* () {
        const { page, preview } = yield* publishedAndPreviewed((event) => {
          A.updateText(event, ["title"], "Launch");
          setSummary(event, "  Come along  ");
          setFormattedBody(event);
          setTimes(event, {
            start,
            end,
            deadline: "2036-10-14T12:00+02:00[Europe/Oslo]",
            foodDeadline: "2036-10-13T12:00+02:00[Europe/Oslo]",
          });
          setPlace(event, "Kantina, 2. etasje");
          // Guests ticked on a members-only event: they can't sign up.
          (event as { public: boolean }).public = false;
          (event as { guests: boolean }).guests = true;
          (event as { dietary: boolean }).dietary = true;
          (event as { food: string }).food = "Pizza";
          addTags(event, "Workshop", "workshop", "Food");
          setStreamed(event, true, "  https://example.com/live  ");
          setLimit(event, 30);
          (event as { hidePlacesLeft: boolean }).hidePlacesLeft = true;
          setCover(event, "/api/images/abcdefghijklmnopqrstuv");
          setQuestions(event, [
            { id: question, type: "text", text: "Why?", required: true },
            {
              id: "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a04",
              type: "choice",
              text: "Which?",
              options: [
                { id: choiceA, text: "A" },
                { id: choiceB, text: "B" },
              ],
            },
          ]);
        });
        assert.deepStrictEqual(preview, page);
      }),
  );

  it.effect(
    "gives a checkbox question's answer option, as publishing does (AC-2)",
    () =>
      Effect.gen(function* () {
        const swim = {
          id: "6f1f6a1e-3a0b-4a53-9a44-0f6a8f3c1a05",
          type: "checkbox",
          text: "Skal du bade?",
          label: "Ja, jeg vil leie badebukse",
          required: false,
          options: [],
        } as const;
        const { page, preview } = yield* publishedAndPreviewed((event) => {
          A.updateText(event, ["title"], "Swim");
          setTimes(event);
          setPlace(event);
          setQuestions(event, [
            swim,
            { id: question, type: "checkbox", text: "I bring a friend" },
          ]);
        });
        assert.deepStrictEqual(page.questions, [
          swim,
          {
            id: question,
            type: "checkbox",
            text: "I bring a friend",
            required: false,
            options: [],
          },
        ]);
        assert.deepStrictEqual(preview, page);
      }),
  );

  it.effect(
    "gives the row publishing gives, for drafts with fields missing (AC-2)",
    () =>
      Effect.gen(function* () {
        // No summary key, no hidePlacesLeft, no streamed: drafts from before.
        const bare = yield* publishedAndPreviewed((event) => {
          A.updateText(event, ["title"], "Bare");
          setTimes(event);
          setPlace(event);
          delete (event as { summary?: string }).summary;
        });
        assert.deepStrictEqual(bare.preview, bare.page);

        // A link on an event that is not streamed is not published.
        const unstreamed = yield* publishedAndPreviewed((event) => {
          A.updateText(event, ["title"], "Not streamed");
          setTimes(event);
          setPlace(event);
          setStreamed(event, false, "https://example.com/live");
        });
        assert.deepStrictEqual(unstreamed.preview, unstreamed.page);
        assert.strictEqual(unstreamed.preview?.streamLink, null);

        // A blank link on a streamed event is none.
        const blank = yield* publishedAndPreviewed((event) => {
          A.updateText(event, ["title"], "Streamed");
          setTimes(event);
          setPlace(event);
          setStreamed(event, true, "   ");
        });
        assert.deepStrictEqual(blank.preview, blank.page);
      }),
  );

  it.effect("gives a blank or missing place as none (AC-2)", () =>
    Effect.gen(function* () {
      const blank = yield* draftWith((event) => {
        A.updateText(event, ["title"], "Placeless");
        setTimes(event);
        setPlace(event, "  ");
      });
      // A new draft's place is "" before it is written.
      const empty = yield* draftWith((event) => {
        A.updateText(event, ["title"], "Placeless");
        setTimes(event);
      });
      const missing = yield* draftWith((event) => {
        A.updateText(event, ["title"], "Placeless");
        setTimes(event);
        delete (event as { place?: string }).place;
      });
      for (const draft of [blank, empty, missing]) {
        assert.strictEqual(previewOf(draft.id, draft.editor)?.place, null);
      }
    }),
  );

  it.effect(
    "shows a draft never published, with its title and times (AC-5)",
    () =>
      Effect.gen(function* () {
        const draft = yield* draftWith((event) => {
          A.updateText(event, ["title"], "Not yet");
          setTimes(event);
          setPlace(event);
        });
        const preview = previewOf(draft.id, draft.editor);
        assert.strictEqual(preview?.id, draft.id);
        assert.strictEqual(preview?.title, "Not yet");
        assert.deepStrictEqual(
          preview?.startsAt,
          new Date("2036-10-15T16:00:00Z"),
        );
        assert.deepStrictEqual(
          preview?.endsAt,
          new Date("2036-10-15T19:00:00Z"),
        );
        assert.strictEqual(preview?.timeZone, "Europe/Oslo");
        assert.deepStrictEqual(preview?.organizer, organizer);
      }),
  );

  it.effect("gives nothing for a draft without a start or an end (AC-5)", () =>
    Effect.gen(function* () {
      const none = yield* draftWith((event) => {
        A.updateText(event, ["title"], "Untimed");
      });
      const noEnd = yield* draftWith((event) => {
        setTimes(event, { start });
      });
      const noStart = yield* draftWith((event) => {
        setTimes(event, { end });
      });
      for (const draft of [none, noEnd, noStart]) {
        assert.isNull(previewOf(draft.id, draft.editor));
      }
    }),
  );
});
