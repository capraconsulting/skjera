import { composeServices, startComposeServices } from "@skjera/test";

// The tests run against the Postgres and object storage from the repository's
// compose.yml; start them if needed.
export default function setup() {
  startComposeServices(composeServices.server);
}
