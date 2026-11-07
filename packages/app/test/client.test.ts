import { glob, readFile } from "node:fs/promises";
import type { TeamId } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import * as client from "../src/site/client.ts";

describe("the shared server client", () => {
  it("retries startup responses through its one transport (AC-5)", async () => {
    const originalFetch = globalThis.fetch;
    const responses = [
      new Response(null, { status: 503 }),
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ];
    globalThis.fetch = async () => responses.shift() as Response;

    try {
      const response = await client.fetchWhileStarting("/api/site");
      expect(response.status).toBe(200);
      expect(responses).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("carries one decoded refusal and its caller-visible message (AC-2)", async () => {
    const id = "00000000-0000-4000-8000-000000000001" as TeamId;
    const problem = { _tag: "TeamNotEmpty" } as const;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          _tag: "TeamNotEmpty",
          id,
          problem,
          message: "Only teams without events can be deleted.",
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );

    const error = await client
      .runRequest((api) => api.teams.delete({ params: { id } }))
      .catch((failure: unknown) => failure);
    globalThis.fetch = originalFetch;

    expect(error).toBeInstanceOf(client.AppError);
    expect(error).toMatchObject(
      new client.AppError("Only teams without events can be deleted.", problem),
    );
  });

  it("keeps every app request behind the shared transport (AC-5)", async () => {
    const requestSites: Array<string> = [];
    const sourceRoot = new URL("../src/", import.meta.url);
    for await (const file of glob("**/*.{ts,tsx}", { cwd: sourceRoot })) {
      const source = await readFile(new URL(file, sourceRoot), "utf8");
      if (/\bfetch\s*\(/.test(source)) requestSites.push(file);
    }

    expect(requestSites).toEqual(["site/client.ts"]);
  });
});
