import { execFileSync } from "node:child_process";

// The tests run against the Postgres and object storage from the repository's
// compose.yml; start them if needed.
export default function setup() {
  execFileSync(
    "docker",
    ["compose", "up", "--detach", "--wait", "postgres", "rustfs"],
    {
      cwd: new URL("../../..", import.meta.url),
      stdio: "inherit",
    },
  );
}
