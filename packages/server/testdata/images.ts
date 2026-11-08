import { crc32, deflateSync } from "node:zlib";

export type Colour =
  | "red"
  | "green"
  | "blue"
  | "yellow"
  | "purple"
  | "orange"
  | "teal"
  | "pink"
  | "gray";

const rgb: Record<Colour, readonly [number, number, number]> = {
  red: [220, 53, 69],
  green: [40, 167, 69],
  blue: [13, 110, 253],
  yellow: [255, 193, 7],
  purple: [111, 66, 193],
  orange: [253, 126, 20],
  teal: [32, 201, 151],
  pink: [214, 51, 132],
  gray: [108, 117, 125],
};

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
