import { composeServices, startComposeServices } from "@skjera/test";

// The SMTP tests send to Mailpit from the repository's compose.yml; start
// it if needed.
export default function setup() {
  startComposeServices(composeServices.email);
}
