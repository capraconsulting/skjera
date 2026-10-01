import { assert, layer } from "@effect/vitest";
import { Effect, Option, Stream } from "effect";
import { Images, sniffImageType } from "../src/Images.ts";

// The smallest valid PNG: one transparent pixel.
const png = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  ),
);

const bytes = (text: string) => new TextEncoder().encode(text);

const read = (body: ReadableStream<Uint8Array>) =>
  Stream.fromReadableStream({ evaluate: () => body, onError: (e) => e }).pipe(
    Stream.runCollect,
    Effect.map((chunks) => Buffer.concat([...chunks])),
  );

// Real clock: these tests talk to the object storage from compose.yml.
layer(Images.layer, { excludeTestServices: true })("Images", (it) => {
  it("tells image formats by their first bytes", () => {
    assert.strictEqual(sniffImageType(png), "image/png");
    assert.strictEqual(
      sniffImageType(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0)),
      "image/jpeg",
    );
    assert.strictEqual(sniffImageType(bytes("GIF89a....")), "image/gif");
    assert.strictEqual(
      sniffImageType(bytes("RIFF\0\0\0\0WEBPVP8 ")),
      "image/webp",
    );
    assert.strictEqual(
      sniffImageType(bytes("\0\0\0\x1cftypavif")),
      "image/avif",
    );
    assert.isNull(
      sniffImageType(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")),
    );
    assert.isNull(sniffImageType(bytes("<html><script>alert(1)</script>")));
    assert.isNull(sniffImageType(new Uint8Array()));
  });

  it.effect("stores an image and serves it back", () =>
    Effect.gen(function* () {
      const images = yield* Images;
      const { id, url } = yield* images.upload(png);
      assert.match(id, /^[A-Za-z0-9_-]{22}$/);
      assert.strictEqual(url, `/api/images/${id}`);

      const image = yield* images.get(id);
      assert.isTrue(Option.isSome(image));
      if (Option.isNone(image)) return;
      assert.strictEqual(image.value.contentType, "image/png");
      assert.deepStrictEqual(yield* read(image.value.body), Buffer.from(png));

      assert.isTrue(Option.isNone(yield* images.get("AAAAAAAAAAAAAAAAAAAAAA")));
      assert.isTrue(Option.isNone(yield* images.get("../secrets")));
    }),
  );

  it.effect("refuses what isn't an image", () =>
    Effect.gen(function* () {
      const images = yield* Images;
      const error = yield* images
        .upload(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>"))
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "InvalidImage");
    }),
  );
});
