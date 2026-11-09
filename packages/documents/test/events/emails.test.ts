import * as A from "@automerge/automerge";
import { assert, layer } from "@effect/vitest";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";
import { Documents } from "../../src/events/documents/index.ts";
import type { DocumentId } from "../../src/Model.ts";
import {
  alice,
  emailKinds,
  openEditor,
  publishedEvent,
  setEmailField,
  setEmailRichText,
  TestLayer,
} from "../helpers.ts";

// Real clock: these tests talk to a real database.
layer(TestLayer, { excludeTestServices: true })("Event emails", (it) => {
  it.effect(
    "publishes each email's own subject trimmed and its text as spans",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const id = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            for (const kind of emailKinds) {
              setEmailField(event, `${kind}Subject`, `  ${kind}\nsubject `);
              setEmailRichText(event, `${kind}Text`);
            }
          },
        });
        const [row] = yield* sql<{ email_texts: Record<string, unknown> }>`
          SELECT email_texts FROM events WHERE id = ${id}
        `;
        const texts = row?.email_texts ?? {};
        for (const kind of emailKinds) {
          // A line break is a space, and the rest as written.
          assert.strictEqual(texts[`${kind}Subject`], `${kind} subject`);
          // The structure is kept: a heading, a list item, a bold run.
          assert.deepStrictEqual(texts[`${kind}Text`], [
            {
              type: "block",
              value: { type: "heading", attrs: { level: 2 }, parents: [] },
            },
            { type: "text", value: "News" },
            {
              type: "block",
              value: { type: "unordered-list-item", attrs: {}, parents: [] },
            },
            { type: "text", value: "Bring a friend" },
            {
              type: "block",
              value: { type: "paragraph", attrs: {}, parents: [] },
            },
            { type: "text", value: "We're " },
            { type: "text", value: "live", marks: { strong: true } },
          ]);
        }
      }),
  );

  it.effect("publishes a changed email subject again", () =>
    Effect.gen(function* () {
      const documents = yield* Documents;
      const sql = yield* SqlClient.SqlClient;
      const id = yield* publishedEvent({
        public: true,
        guests: true,
        edit: (event) => setEmailField(event, "signedUpSubject", "Welcome"),
      });
      const editor = yield* openEditor(id);
      const heads = yield* documents.applyChanges(
        id,
        [
          editor.edit((event) =>
            A.updateText(event, ["signedUpSubject"], "See you there"),
          ),
        ],
        alice,
      );
      yield* documents.publish(id, heads, alice);
      const [row] = yield* sql<{ email_texts: Record<string, unknown> }>`
        SELECT email_texts FROM events WHERE id = ${id}
      `;
      assert.strictEqual(row?.email_texts["signedUpSubject"], "See you there");
    }),
  );

  it.effect(
    "publishes blank subjects and texts, and an older draft's, as none",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const emailTextsOf = (id: DocumentId) =>
          sql<{ email_texts: Record<string, unknown> }>`
            SELECT email_texts FROM events WHERE id = ${id}
          `.pipe(Effect.map((rows) => rows[0]?.email_texts));
        const blank = yield* publishedEvent({
          public: true,
          guests: true,
          edit: (event) => {
            for (const kind of emailKinds) {
              setEmailField(event, `${kind}Subject`, " \t ");
            }
            // Only whitespace, or only an empty paragraph.
            setEmailField(event, "signedUpText", " \n ");
            const draft = event as Record<string, unknown>;
            draft["eventChangedText"] = "";
            A.splitBlock(event, ["eventChangedText"], 0, {
              type: new A.ImmutableString("paragraph"),
              parents: [],
              attrs: {},
            });
          },
        });
        assert.deepStrictEqual(yield* emailTextsOf(blank), {});

        // A draft from before these fields existed has no keys for them.
        const older = yield* publishedEvent({ public: true, guests: true });
        assert.deepStrictEqual(yield* emailTextsOf(older), {});
      }),
  );
});
