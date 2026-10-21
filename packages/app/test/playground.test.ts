import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { includesPlayground } from "../vite.config.ts";

describe("includesPlayground", () => {
  it("is on for the dev server without any setting (AC-2)", () => {
    expect(includesPlayground("serve", {})).toBe(true);
  });

  it("is on in a build made with SKJERA_PLAYGROUND=true (AC-3)", () => {
    expect(includesPlayground("build", { SKJERA_PLAYGROUND: "true" })).toBe(
      true,
    );
  });

  it("is off in a build made without the setting, or with any other value (AC-4)", () => {
    expect(includesPlayground("build", {})).toBe(false);
    expect(includesPlayground("build", { SKJERA_PLAYGROUND: "false" })).toBe(
      false,
    );
    expect(includesPlayground("build", { SKJERA_PLAYGROUND: "1" })).toBe(false);
  });
});

describe("the production build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has no /playground route and none of the page's code (AC-1, AC-5)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SKJERA_PLAYGROUND", undefined);

    const result = await build({
      root: fileURLToPath(new URL("..", import.meta.url)),
      logLevel: "silent",
      build: { write: false },
    });

    const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) =>
      "output" in r ? r.output : [],
    );
    const text = outputs
      .map((file) =>
        file.type === "chunk"
          ? file.code
          : typeof file.source === "string"
            ? file.source
            : "",
      )
      .join("\n");

    // The minifier may write a string with any of three quotes.
    const path = (p: string) => new RegExp(`["'\`]${p}["'\`]`);
    expect(text).toMatch(path("/studio"));
    expect(text).not.toMatch(path("/playground"));
    expect(text).not.toContain("Replica");
  }, 120_000);
});
