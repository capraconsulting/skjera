import { execFileSync } from "node:child_process";

// The tests run against the Postgres from the repository's compose.yml,
// which has the extension's files mounted; start it if needed.
export default function setup() {
  execFileSync("docker", ["compose", "up", "--detach", "--wait", "postgres"], {
    cwd: new URL("../../..", import.meta.url),
    stdio: "inherit",
  });
}
