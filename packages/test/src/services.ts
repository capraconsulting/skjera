import { execFileSync } from "node:child_process";
import { composeServices } from "./settings.ts";

execFileSync(
  "docker",
  [
    "compose",
    "up",
    "--detach",
    "--wait",
    ...new Set(Object.values(composeServices).flat()),
  ],
  { cwd: new URL("../../..", import.meta.url), stdio: "inherit" },
);
