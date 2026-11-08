import { composeServices, startComposeServices } from "@skjera/test";

// The tests run against the Postgres from the repository's compose.yml;
// start it if needed.
export default function setup() {
  startComposeServices(composeServices.snapsync);
}
