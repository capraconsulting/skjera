import { assert, describe, layer, it as plain } from "@effect/vitest";
import { Effect, Logger, Option, Stream } from "effect";
import { maxImageBytes } from "../../src/api/ImagesApi.ts";
import {
  Images,
  imageSize,
  listedObjects,
  pageOf,
  readImageSize,
  sniffImageType,
} from "../../src/events/Images.ts";

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

  it.effect("deletes an image and accepts an absent image (AC-1)", () =>
    Effect.gen(function* () {
      const images = yield* Images;
      const { id } = yield* images.upload(png);

      yield* images.delete(id);
      assert.isTrue(Option.isNone(yield* images.get(id)));
      yield* images.delete(id);
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

  it.effect(
    "refuses an image over 10 MB and takes one of exactly 10 MB (AC-3)",
    () =>
      Effect.gen(function* () {
        const images = yield* Images;
        const sized = (length: number) => {
          const bytes = new Uint8Array(length);
          bytes.set(png);
          return bytes;
        };
        const error = yield* images
          .upload(sized(maxImageBytes + 1))
          .pipe(Effect.flip);
        assert.strictEqual(error._tag, "InvalidImage");
        assert.strictEqual(error.problem._tag, "ImageTooBig");
        assert.strictEqual(error.message, "Images can be at most 10 MB");

        const { url } = yield* images.upload(sized(maxImageBytes));
        assert.match(url, /^\/api\/images\//);
      }),
    30_000,
  );

  it.effect("lists an image just uploaded, with when it came (AC-2)", () =>
    Effect.gen(function* () {
      const images = yield* Images;
      const { id } = yield* images.upload(png);
      const listed = (yield* images.list()).find((image) => image.id === id);
      assert.isDefined(listed);
      if (listed === undefined) return;
      assert.isBelow(
        Math.abs(Date.now() - listed.uploadedAt.getTime()),
        60_000,
      );
    }),
  );
});

const listed = (id: string, at: string) => ({
  id,
  uploadedAt: new Date(at),
});
const idA = "AAAAAAAAAAAAAAAAAAAAAA";
const idB = "BBBBBBBBBBBBBBBBBBBBBB";
const idC = "CCCCCCCCCCCCCCCCCCCCCC";
const idD = "DDDDDDDDDDDDDDDDDDDDDD";

describe("pageOf", () => {
  plain("puts the newest first and ties in id order (AC-2)", () => {
    const page = pageOf(
      [
        listed(idC, "2026-11-04T10:00:00.000Z"),
        listed(idB, "2026-11-04T12:00:00.000Z"),
        listed(idD, "2026-11-04T10:00:00.000Z"),
        listed(idA, "2026-11-04T11:00:00.000Z"),
      ],
      undefined,
      10,
    );
    assert.deepStrictEqual(
      page?.images.map((image) => image.id),
      [idB, idA, idC, idD],
    );
    assert.isNull(page?.next);
  });

  plain("follows next to the end, each image once (AC-3)", () => {
    const all = [idA, idB, idC, idD, "EEEEEEEEEEEEEEEEEEEEEE"].map((id, at) =>
      listed(id, `2026-11-04T10:00:0${at % 3}.000Z`),
    );
    const seen: Array<string> = [];
    let after: string | undefined;
    let pages = 0;
    while (true) {
      const page = pageOf(all, after, 2);
      assert.isDefined(page);
      if (page === undefined) return;
      pages++;
      seen.push(...page.images.map((image) => image.id));
      if (page.next === null) break;
      after = page.next;
    }
    assert.strictEqual(pages, 3);
    assert.deepStrictEqual(
      [...seen].sort(),
      all.map((image) => image.id).sort(),
    );
    assert.strictEqual(new Set(seen).size, all.length);
  });

  plain("gives none for a cursor it cannot read (AC-3)", () => {
    const all = [listed(idA, "2026-11-04T10:00:00.000Z")];
    for (const after of [
      "nonsense",
      "abc.def",
      ".",
      "12.",
      "x.AAAAAAAAAAAAAAAAAAAAAA",
    ]) {
      assert.isUndefined(pageOf(all, after, 10), after);
    }
  });
});

describe("listedObjects", () => {
  const xml = (contents: string, token = "") =>
    `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>skjera-images</Name><KeyCount>2</KeyCount>${contents}${token}</ListBucketResult>`;
  const entry = (key: string, at: string) =>
    `<Contents><Key>${key}</Key><LastModified>${at}</LastModified><ETag>"x"</ETag><Size>10</Size></Contents>`;

  plain("reads keys, times and the continuation token (AC-2)", () => {
    const found = listedObjects(
      xml(
        entry(idA, "2026-11-04T10:00:00.000Z") +
          entry(idB, "2026-11-04T11:00:00Z"),
        "<IsTruncated>true</IsTruncated><NextContinuationToken>token-1</NextContinuationToken>",
      ),
    );
    assert.deepStrictEqual(
      found.images.map((image) => [image.id, image.uploadedAt.toISOString()]),
      [
        [idA, "2026-11-04T10:00:00.000Z"],
        [idB, "2026-11-04T11:00:00.000Z"],
      ],
    );
    assert.strictEqual(found.next, "token-1");
  });

  plain(
    "has no token on the last page, and leaves out keys that are no image id (AC-2)",
    () => {
      const found = listedObjects(
        xml(
          entry("not-an-image-id", "2026-11-04T10:00:00.000Z") +
            entry(`${idA}x`, "2026-11-04T10:00:00.000Z") +
            entry(idC, "2026-11-04T10:00:00.000Z"),
          "<IsTruncated>false</IsTruncated>",
        ),
      );
      assert.deepStrictEqual(
        found.images.map((image) => image.id),
        [idC],
      );
      assert.isNull(found.next);
    },
  );
});

// The first bytes of each format, made by hand: only the fields the size is
// read from are meaningful.

const concat = (...parts: ReadonlyArray<Uint8Array | ReadonlyArray<number>>) =>
  Uint8Array.from(parts.flatMap((part) => [...part]));
const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [...be16(n >>> 16), ...be16(n & 0xffff)];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le24 = (n: number) => [...le16(n), (n >> 16) & 0xff];

const pngOf = (width: number, height: number) =>
  concat(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    be32(13),
    bytes("IHDR"),
    be32(width),
    be32(height),
    [8, 6, 0, 0, 0],
  );

const gifOf = (width: number, height: number) =>
  concat(bytes("GIF89a"), le16(width), le16(height), [0, 0, 0]);

const riff = (...chunk: ReadonlyArray<Uint8Array | ReadonlyArray<number>>) =>
  concat(bytes("RIFF"), [0, 0, 0, 0], bytes("WEBP"), ...chunk);

const webpLossy = (width: number, height: number) =>
  riff(
    bytes("VP8 "),
    [0, 0, 0, 0],
    [0, 0, 0],
    [0x9d, 0x01, 0x2a],
    le16(width),
    le16(height),
  );

const webpLossless = (width: number, height: number) => {
  // 14 bits of width - 1, then 14 bits of height - 1, least significant first.
  const bits = BigInt(width - 1) | (BigInt(height - 1) << 14n);
  return riff(
    bytes("VP8L"),
    [0, 0, 0, 0],
    [0x2f],
    [0, 1, 2, 3].map((i) => Number((bits >> BigInt(8 * i)) & 0xffn)),
  );
};

const webpExtended = (width: number, height: number) =>
  riff(
    bytes("VP8X"),
    le16(10),
    [0, 0],
    [0, 0, 0, 0],
    le24(width - 1),
    le24(height - 1),
  );

const segment = (marker: number, payload: ReadonlyArray<number>) => [
  0xff,
  marker,
  ...be16(payload.length + 2),
  ...payload,
];

const exifOrientation = (orientation: number) =>
  segment(0xe1, [
    ...bytes("Exif\0\0"),
    ...bytes("MM"),
    ...be16(42),
    ...be32(8),
    ...be16(1),
    ...be16(0x0112),
    ...be16(3),
    ...be32(1),
    ...be16(orientation),
    0,
    0,
    ...be32(0),
  ]);

const jpegOf = (
  width: number,
  height: number,
  before: ReadonlyArray<number> = [],
) =>
  concat(
    [0xff, 0xd8],
    before,
    segment(0xc0, [8, ...be16(height), ...be16(width), 1, 1, 0x11, 0]),
  );

const box = (
  type: string,
  ...payload: ReadonlyArray<ReadonlyArray<number>>
) => {
  const content = payload.flat();
  return [...be32(8 + content.length), ...bytes(type), ...content];
};
const ispe = (width: number, height: number) =>
  box("ispe", [0, 0, 0, 0], be32(width), be32(height));

const avifOf = (
  ...properties: ReadonlyArray<ReadonlyArray<number>>
): Uint8Array =>
  concat(
    box("ftyp", [...bytes("avif"), 0, 0, 0, 0]),
    // `meta` is a full box: four bytes of version and flags before its children.
    box("meta", [0, 0, 0, 0], box("iprp", box("ipco", ...properties))),
  );

describe("imageSize", () => {
  plain("reads the width and height of each format (AC-5)", () => {
    const size = (width: number, height: number) => ({ width, height });
    assert.deepStrictEqual(imageSize(pngOf(1200, 630)), size(1200, 630));
    assert.deepStrictEqual(imageSize(gifOf(320, 200)), size(320, 200));
    assert.deepStrictEqual(imageSize(webpLossy(800, 600)), size(800, 600));
    assert.deepStrictEqual(imageSize(webpLossless(1600, 900)), size(1600, 900));
    assert.deepStrictEqual(
      imageSize(webpExtended(4000, 3000)),
      size(4000, 3000),
    );
    assert.deepStrictEqual(imageSize(jpegOf(1920, 1080)), size(1920, 1080));
    assert.deepStrictEqual(
      imageSize(avifOf(ispe(2048, 1365))),
      size(2048, 1365),
    );
  });

  plain("walks past a JPEG's earlier segments to the size (AC-5)", () => {
    const earlier = [
      ...segment(0xe0, [...bytes("JFIF\0")]),
      ...exifOrientation(1),
      // Fill bytes before a marker, and a marker that has no length.
      0xff,
      0xff,
      0xff,
      0x01,
      ...segment(0xdb, new Array(65).fill(0)),
    ];
    assert.deepStrictEqual(imageSize(jpegOf(640, 480, earlier)), {
      width: 640,
      height: 480,
    });
  });

  plain(
    "gives a JPEG turned by its orientation the size it is shown at (AC-5)",
    () => {
      for (const orientation of [5, 6, 7, 8]) {
        assert.deepStrictEqual(
          imageSize(jpegOf(640, 480, exifOrientation(orientation))),
          { width: 480, height: 640 },
          `orientation ${orientation}`,
        );
      }
      for (const orientation of [1, 2, 3, 4]) {
        assert.deepStrictEqual(
          imageSize(jpegOf(640, 480, exifOrientation(orientation))),
          { width: 640, height: 480 },
          `orientation ${orientation}`,
        );
      }
    },
  );

  plain(
    "takes the largest image of an AVIF and turns it with irot (AC-5)",
    () => {
      assert.deepStrictEqual(
        imageSize(avifOf(ispe(160, 90), ispe(2048, 1365))),
        { width: 2048, height: 1365 },
      );
      assert.deepStrictEqual(
        imageSize(avifOf(ispe(2048, 1365), box("irot", [1]))),
        { width: 1365, height: 2048 },
      );
      assert.deepStrictEqual(
        imageSize(avifOf(ispe(2048, 1365), box("irot", [2]))),
        { width: 2048, height: 1365 },
      );
    },
  );

  plain(
    "gives none for bytes that end before the size or are no image (AC-5)",
    () => {
      for (const image of [
        pngOf(10, 10),
        gifOf(10, 10),
        webpLossy(10, 10),
        webpLossless(10, 10),
        webpExtended(10, 10),
        jpegOf(10, 10),
        avifOf(ispe(10, 10)),
      ]) {
        assert.isUndefined(imageSize(image.subarray(0, 9)));
      }
      assert.isUndefined(
        imageSize(bytes("<svg xmlns='http://www.w3.org/2000/svg'/>")),
      );
      assert.isUndefined(imageSize(new Uint8Array()));
    },
  );
});

describe("readImageSize", () => {
  /** A body that gives `chunks` one read at a time, and notes reads and cancelling. */
  const body = (chunks: ReadonlyArray<Uint8Array>) => {
    const seen = { reads: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = chunks[seen.reads++];
          if (chunk === undefined) controller.close();
          else controller.enqueue(chunk);
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, seen };
  };

  plain.effect(
    "logs the cause and gives no size when the body fails (AC-4)",
    () =>
      Effect.gen(function* () {
        const failure = new Error("Body failed");
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(failure);
          },
        });
        const log: Array<{ message: unknown; cause: unknown }> = [];
        const size = yield* readImageSize(stream).pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ message, cause }) => log.push({ message, cause })),
            ]),
          ),
        );
        assert.isUndefined(size);
        assert.lengthOf(log, 1);
        assert.include(String(log[0]?.message), "image size");
        assert.include(String(log[0]?.cause), "Body failed");
      }),
  );

  plain.effect(
    "gives the size without reading on, and cancels the stream (AC-5)",
    () =>
      Effect.gen(function* () {
        const { stream, seen } = body([pngOf(1600, 900), new Uint8Array(1024)]);
        const size = yield* readImageSize(stream);
        assert.deepStrictEqual(size, { width: 1600, height: 900 });
        assert.strictEqual(seen.reads, 1);
        assert.isTrue(seen.cancelled);
      }),
  );

  plain.effect("joins chunks until the size is there (AC-5)", () =>
    Effect.gen(function* () {
      const image = jpegOf(640, 480, exifOrientation(1));
      const { stream, seen } = body([
        image.subarray(0, 5),
        image.subarray(5, 30),
        image.subarray(30),
        new Uint8Array(1024),
      ]);
      const size = yield* readImageSize(stream);
      assert.deepStrictEqual(size, { width: 640, height: 480 });
      assert.isAtMost(seen.reads, 3);
      assert.isTrue(seen.cancelled);
    }),
  );

  plain.effect(
    "stops at the limit, and gives none for what is no image (AC-5)",
    () =>
      Effect.gen(function* () {
        const { stream, seen } = body([
          new Uint8Array(100),
          new Uint8Array(100),
          new Uint8Array(100),
        ]);
        assert.isUndefined(yield* readImageSize(stream, 150));
        assert.isAtMost(seen.reads, 2);
        assert.isTrue(seen.cancelled);
      }),
  );
});
