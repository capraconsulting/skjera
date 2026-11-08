import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { snapsyncBuildContract } from "../src/buildContract.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("server build", () => {
  it("validates snapsync's version and extension paths before copying (AC-4)", () => {
    expect(
      snapsyncBuildContract({
        packageJson: readFileSync(
          `${root}/packages/snapsync/package.json`,
          "utf8",
        ),
        control: readFileSync(
          `${root}/packages/snapsync/extension/snapsync.control`,
          "utf8",
        ),
        server: readFileSync(`${root}/packages/snapsync/src/server.ts`, "utf8"),
        dockerfile: readFileSync(`${root}/Dockerfile`, "utf8"),
      }),
    ).toEqual({
      version: "0.1.0",
      extensionDirectory: "../snapsync/extension",
    });
  });
});
