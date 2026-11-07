import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as A from "@automerge/automerge/slim";
import { init, pmDocFromSpans, pmNodeToSpans } from "@automerge/prosemirror";
import {
  defaultImageChoices,
  imagePlacements,
  imageSizes,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { baseLocale, overwriteGetLocale } from "@skjera/i18n/runtime";
import { Fragment, type Node, type Schema } from "prosemirror-model";
import { EditorState, NodeSelection } from "prosemirror-state";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withDefaults } from "../src/editor/text/imageUploads.ts";
import {
  choicesToStore,
  defaultChoices,
  type ImageChoices,
  imageChoices,
  insertImage,
  newImage,
  richTextAdapter,
  setImage,
  shownImage,
  toolbarState,
} from "../src/editor/text/richText.ts";

const nb = { locale: "nb" } as const;
const schema: Schema = richTextAdapter.schema;
const src = "https://images.example.com/cat.png";

beforeAll(async () => {
  overwriteGetLocale(() => "nb");
  const wasm = createRequire(import.meta.url).resolve(
    "@automerge/automerge/automerge.wasm",
  );
  await A.initializeWasm(await readFile(wasm));
});

afterAll(() => {
  overwriteGetLocale(() => baseLocale);
});

const chosen: ImageChoices = {
  placement: "left",
  size: "small",
  caption: "A caption",
};

/** A document with one paragraph holding the image. */
const docWith = (image: Node) =>
  schema.nodes["doc"]?.create(null, [
    schema.nodes["paragraph"]?.create(null, [image]) as Node,
  ]) as Node;

/** A state with the image selected, as when it is clicked. */
const selected = (image: Node) => {
  const doc = docWith(image);
  return EditorState.create({
    schema,
    doc,
    selection: NodeSelection.create(doc, 1),
  });
};

const imageIn = (doc: Node) => {
  let found: Node | null = null;
  doc.descendants((node) => {
    if (node.type.name === "image") found = node;
  });
  if (found === null) throw new Error("No image in the document");
  return found as Node;
};

const run = (
  state: EditorState,
  command: (
    state: EditorState,
    dispatch: (tr: EditorState["tr"]) => void,
  ) => boolean,
) => {
  let next = state;
  command(state, (tr) => {
    next = state.apply(tr);
  });
  return next;
};

/** Image attributes as the published body hands them out: plain strings. */
const withStored = (stored: Record<string, string>) =>
  schema.nodes["image"]?.create({
    src,
    alt: "A cat",
    unknownAttrs: stored,
  }) as Node;

describe("an image's choices", () => {
  it("uses the document model's choices and defaults (AC-1)", () => {
    expect(imagePlacements).toEqual(["full", "left", "right", "center"]);
    expect(imageSizes).toEqual(["small", "medium", "large"]);
    expect(defaultChoices).toBe(defaultImageChoices);
  });
  it("are 'Full bredde' and 'Medium' for an image made with nothing chosen (AC-2)", () => {
    const made = newImage(schema, src, "A cat");
    expect(imageChoices(made.attrs)).toEqual(defaultChoices);
    expect(defaultChoices).toEqual({
      placement: "full",
      size: "medium",
      caption: "",
    });

    const inserted = run(
      EditorState.create({ schema, doc: docWith(made) }),
      insertImage(src, "A cat"),
    );
    expect(imageChoices(imageIn(inserted.doc).attrs)).toEqual(defaultChoices);
  });

  it("read as the defaults when the stored value is not a known one (AC-2)", () => {
    const choices = imageChoices(
      withStored({ placement: "top", size: "huge", caption: "Hi" }).attrs,
    );
    expect(choices).toEqual({
      placement: "full",
      size: "medium",
      caption: "Hi",
    });
  });

  it("reads a missing size from the document model's current default (AC-1)", () => {
    const defaults = defaultImageChoices as { size: "medium" | "large" };
    defaults.size = "large";
    try {
      expect(imageChoices(withStored({ placement: "left" }).attrs)).toEqual({
        placement: "left",
        size: "large",
        caption: "",
      });
    } finally {
      defaults.size = "medium";
    }
  });

  it("read the stored placement, size and caption, as strings or immutable strings (AC-3, AC-4, AC-6)", () => {
    for (const [placement, size] of [
      ["left", "small"],
      ["right", "medium"],
      ["center", "large"],
    ] as const) {
      const plain = imageChoices(withStored({ placement, size }).attrs);
      expect(plain).toEqual({ placement, size, caption: "" });
      const immutable = imageChoices(
        schema.nodes["image"]?.create({
          src,
          unknownAttrs: {
            placement: new A.ImmutableString(placement),
            size: new A.ImmutableString(size),
          },
        }).attrs ?? {},
      );
      expect(immutable).toEqual({ placement, size, caption: "" });
    }
  });

  it("have no caption when it is empty or only spaces (AC-7)", () => {
    for (const caption of ["", "   "]) {
      const choices = imageChoices(
        withStored({ placement: "left", size: "small", caption }).attrs,
      );
      expect(choices?.caption).toBe("");
    }
  });

  it("are none for an image stored with only an address and a description (AC-9)", () => {
    const old = schema.nodes["image"]?.create({ src, alt: "A cat" }) as Node;
    expect(imageChoices(old.attrs)).toBeNull();
    expect(shownImage(old.attrs).choices).toBeNull();
  });
});

describe("the alt text an image is shown with", () => {
  it("is the fallback in the page's language when it has none (AC-8)", () => {
    const fallback = m.site_image_alt({}, nb);
    for (const alt of [undefined, null, "", "   "]) {
      const image = schema.nodes["image"]?.create({ src, alt }) as Node;
      expect(shownImage(image.attrs).alt).toBe(fallback);
    }
  });

  it("is its own alt text when it has one (AC-8)", () => {
    const image = schema.nodes["image"]?.create({
      src,
      alt: "A pixel",
    }) as Node;
    expect(shownImage(image.attrs).alt).toBe("A pixel");
  });
});

describe("the choices to store", () => {
  it("are none for an image without choices whose dialog was left at the defaults (AC-9)", () => {
    expect(choicesToStore(null, defaultChoices)).toBeNull();
  });

  it("are all three once one differs, or a caption is given (AC-9)", () => {
    const placed = { ...defaultChoices, placement: "center" } as const;
    expect(choicesToStore(null, placed)).toEqual(placed);
    const captioned = { ...defaultChoices, caption: "Hi" };
    expect(choicesToStore(null, captioned)).toEqual(captioned);
  });

  it("are the chosen ones for an image that has choices stored (AC-9)", () => {
    expect(choicesToStore(chosen, defaultChoices)).toEqual(defaultChoices);
  });
});

describe("the toolbar for a selected image", () => {
  it("reports the defaults, with none stored, for an image without choices (AC-9)", () => {
    const old = schema.nodes["image"]?.create({ src, alt: "A cat" }) as Node;
    expect(toolbarState(selected(old)).image).toEqual({
      alt: "A cat",
      choices: defaultChoices,
      stored: false,
    });
  });

  it("reports the stored choices (AC-1)", () => {
    const image = newImage(schema, src, "A cat", chosen);
    expect(toolbarState(selected(image)).image).toEqual({
      alt: "A cat",
      choices: chosen,
      stored: true,
    });
  });

  it("keeps the address and the alt text when the placement changes (AC-1)", () => {
    const pasted = newImage(schema, src, "");
    const state = run(
      selected(pasted),
      setImage("A cat", { ...defaultChoices, placement: "center" }),
    );
    const image = imageIn(state.doc);
    expect(image.attrs["src"]).toBe(src);
    const tools = toolbarState(state).image;
    expect(tools?.alt).toBe("A cat");
    expect(tools?.choices.placement).toBe("center");
  });

  it("changes only the alt text when told to store no choices (AC-9)", () => {
    const old = schema.nodes["image"]?.create({ src, alt: "" }) as Node;
    const state = run(selected(old), setImage("A cat", null));
    expect(imageChoices(imageIn(state.doc).attrs)).toBeNull();
    expect(toolbarState(state).image?.alt).toBe("A cat");
  });

  it("drops the stored caption when it is emptied (AC-7)", () => {
    const image = newImage(schema, src, "A cat", chosen);
    const state = run(
      selected(image),
      setImage("A cat", { ...chosen, caption: "" }),
    );
    expect(imageChoices(imageIn(state.doc).attrs)?.caption).toBe("");
    expect(imageIn(state.doc).attrs["unknownAttrs"]).not.toHaveProperty(
      "caption",
    );
  });
});

describe("an image's choices in the document", () => {
  it("are the same after being written and read back (AC-1)", () => {
    const doc = docWith(newImage(schema, src, "A cat", chosen));
    const spans = pmNodeToSpans(richTextAdapter, doc);
    const back = pmDocFromSpans(richTextAdapter, spans);
    expect(imageChoices(imageIn(back).attrs)).toEqual(chosen);
  });

  /** An Automerge document holding the image, edited through the sync plugin. */
  const editorOver = (image: Node) => {
    const spans = pmNodeToSpans(richTextAdapter, docWith(image));
    let doc = A.from<{ body: string }>({ body: "" });
    doc = A.change(doc, (d) =>
      A.updateSpans(d, ["body"], spans, richTextAdapter.updateSpansConfig()),
    );
    const handle = {
      doc: () => doc,
      change: (fn: (draft: { body: string }) => void) => {
        doc = A.change(doc, fn);
      },
      on: () => {},
      off: () => {},
    };
    const { pmDoc, plugin } = init(handle, ["body"]);
    const state = EditorState.create({ schema, doc: pmDoc, plugins: [plugin] });
    return { state, stored: () => A.spans(doc, ["body"]) };
  };

  const storedImage = (spans: ReadonlyArray<A.Span>) => {
    const block = spans.find(
      (span) => span.type === "block" && String(span.value["type"]) === "image",
    );
    if (block?.type !== "block") throw new Error("No image block stored");
    return Object.fromEntries(
      Object.entries(block.value["attrs"] ?? {}).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  };

  it("change through the library's sync without an error, and survive an edit elsewhere (AC-1)", () => {
    const { state, stored } = editorOver(
      newImage(schema, src, "A cat", {
        placement: "full",
        size: "medium",
        caption: "A long caption",
      }),
    );
    const selectedState = state.apply(
      state.tr.setSelection(NodeSelection.create(state.doc, 1)),
    );

    const changed = run(
      selectedState,
      setImage("A cat", {
        placement: "center",
        size: "medium",
        caption: "Short",
      }),
    );
    expect(storedImage(stored())).toMatchObject({
      placement: "center",
      size: "medium",
      caption: "Short",
    });

    const edited = changed.apply(changed.tr.insertText("Hello", 1));
    expect(edited.doc.textContent).toBe("Hello");
    expect(storedImage(stored())).toMatchObject({
      placement: "center",
      size: "medium",
      caption: "Short",
    });
  });
});

describe("an image pasted as HTML", () => {
  it("gets the choices of a new image, and keeps those it has (AC-2)", () => {
    const bare = schema.nodes["image"]?.create({ src, alt: "A cat" }) as Node;
    const kept = newImage(schema, src, "", chosen);
    const paragraph = schema.nodes["paragraph"]?.create(null, [bare, kept]);
    const out = withDefaults(Fragment.from(paragraph as Node));
    const images: Array<Node> = [];
    out.descendants((node) => {
      if (node.type.name === "image") images.push(node);
    });
    expect(images.map((image) => imageChoices(image.attrs))).toEqual([
      defaultChoices,
      chosen,
    ]);
    expect(images[0]?.attrs["alt"]).toBe("A cat");
  });
});
