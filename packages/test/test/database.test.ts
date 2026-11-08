import { describe, expect, it, vi } from "vitest";
import {
  databaseServerUrl,
  databaseUrl,
  temporaryDatabase,
} from "../src/database.ts";

describe("test databases", () => {
  it("uses one fallback and derives a database URL (AC-6)", () => {
    const server = databaseServerUrl({});
    expect(server).toBe("postgres://skjera:skjera@localhost:5433/skjera");
    expect(databaseUrl(server, "isolated")).toBe(
      "postgres://skjera:skjera@localhost:5433/isolated",
    );
  });

  it("creates and drops a temporary database around its use (AC-6)", async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const value = await temporaryDatabase(
      "postgres://skjera:skjera@localhost:5433/skjera",
      "unit",
      execute,
      async (url) => url,
    );
    expect(value).toMatch(/\/unit_[0-9a-f]{12}$/);
    const name = new URL(value).pathname.slice(1);
    expect(execute.mock.calls).toEqual([
      [`CREATE DATABASE ${name}`],
      [`DROP DATABASE ${name} WITH (FORCE)`],
    ]);
  });
});
