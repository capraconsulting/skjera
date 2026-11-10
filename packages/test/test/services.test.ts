import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("test service startup", () => {
  it("starts services once before the parallel test packages, without caching startup", () => {
    const graph = JSON.parse(
      execFileSync("pnpm", ["exec", "turbo", "run", "test", "--dry=json"], {
        cwd: new URL("../../..", import.meta.url),
        encoding: "utf8",
      }),
    ) as {
      tasks: {
        taskId: string;
        dependencies: string[];
        resolvedTaskDefinition: { cache: boolean };
      }[];
    };
    const startup = graph.tasks.filter(
      (task) => task.taskId === "@skjera/test#services",
    );
    expect(startup).toHaveLength(1);
    expect(startup[0]?.resolvedTaskDefinition.cache).toBe(false);
    for (const name of ["server", "documents", "email", "snapsync"]) {
      const task = graph.tasks.find(
        (task) => task.taskId === `@skjera/${name}#test`,
      );
      expect(task?.dependencies).toContain("@skjera/test#services");
    }
  });
});
