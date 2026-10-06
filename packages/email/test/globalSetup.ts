import { execFileSync } from "node:child_process";

// The SMTP tests send to Mailpit from the repository's compose.yml; start
// it if needed.
export default function setup() {
  execFileSync("docker", ["compose", "up", "--detach", "--wait", "mailpit"], {
    cwd: new URL("../../..", import.meta.url),
    stdio: "inherit",
  });
}
