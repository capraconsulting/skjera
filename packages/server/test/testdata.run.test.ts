import { describe, expect, it } from "vitest";
import { localDatabase, run } from "../testdata.ts";

describe("localDatabase", () => {
  it("refuses a database that is not on localhost or 127.0.0.1 (AC-9)", () => {
    for (const url of [
      "postgres://u:p@db.example.com:5432/skjera",
      "postgres://u:p@10.0.0.5/skjera",
      "postgres://u:p@[::1]:5433/skjera",
      "not a url",
      "",
      undefined,
    ])
      expect(() => localDatabase(url)).toThrow();
  });

  it("takes localhost and 127.0.0.1, on any port and database (AC-9)", () => {
    for (const url of [
      "postgres://skjera:skjera@localhost:5433/skjera",
      "postgres://a:b@127.0.0.1/other",
      "postgres://a:b@localhost:6543/skjera_test",
    ])
      expect(localDatabase(url)).toBe(url);
  });

  it("makes both commands refuse a database elsewhere, naming it, before connecting to anything (AC-9)", async () => {
    for (const command of ["fill", "clear"])
      await expect(
        run(command, { DATABASE_URL: "postgres://u:p@db.example.com:5432/x" }),
      ).rejects.toThrow(/db\.example\.com.*localhost/);
  });
});
