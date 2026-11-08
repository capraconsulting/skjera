import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../..", import.meta.url));

describe("the Compose-to-Turbo environment contract", () => {
  it("passes every interpolated Compose variable through Turbo and omits the stale name (AC-1, AC-2)", () => {
    const compose = readFileSync(`${root}/compose.yml`, "utf8");
    const turbo = JSON.parse(readFileSync(`${root}/turbo.json`, "utf8")) as {
      globalPassThroughEnv: string[];
      tasks: Record<string, { inputs?: string[] }>;
    };
    const composeVariables = [
      ...new Set(
        Array.from(
          compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g),
          (match) => match[1],
        ),
      ),
    ];

    expect(turbo.globalPassThroughEnv).toEqual(
      expect.arrayContaining(composeVariables),
    );
    expect(turbo.globalPassThroughEnv).not.toContain("MAILPIT_UI_ADDRESS");
    expect(turbo.tasks["@skjera/app#test"]?.inputs).toEqual(
      expect.arrayContaining(["$TURBO_ROOT$/compose.yml"]),
    );
  });
});
