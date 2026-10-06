# @skjera/email

Sending email as an Effect service, whatever sends it: Amazon SES, or any
SMTP server (Mailpit in development). Templates are
[React Email](https://react.email) components.

```tsx
import { Email, retryTransient } from "@skjera/email";
import { renderEmail } from "@skjera/email/react";
import { Body, Button, Html, Text } from "react-email";

const confirm = Effect.gen(function* () {
  const email = yield* Email;
  const { html, text } = yield* renderEmail(
    <Html>
      <Body>
        <Text>You're signed up for Launch.</Text>
        <Button href={url}>See the event</Button>
      </Body>
    </Html>,
  );
  yield* email
    .send({
      from: { name: "Skjera", address: "events@example.com" },
      to: "alice@example.com",
      subject: "You're signed up: Launch",
      html,
      text,
      calendar: { method: "REQUEST", content: ics },
    })
    .pipe(retryTransient());
});
```

A `Message` is built into MIME once, with nodemailer's composer, however it
is sent: so attachments and calendar invitations (`calendar`, an iCalendar
`REQUEST` or `CANCEL`, which mail clients offer to put in calendars) come out
alike everywhere. Bcc recipients get it without being named in it.

## Transports

`layerConfig` picks one by `EMAIL_TRANSPORT`:

- `ses` (the default): Amazon SES v2, on AWS's own client, which finds
  credentials as AWS does (environment, profiles, IAM roles) and keeps them
  fresh. `AWS_REGION`, and `SES_CONFIGURATION_SET` to record sends, bounces
  and complaints. The sending domain must be verified in SES (DKIM, SPF),
  and the account out of SES's sandbox to send to anyone.
- `smtp`: the server at `EMAIL_SMTP_URL`, e.g. `smtp://localhost:1025`.

In development, Mailpit (in the repository's `compose.yml`) catches every
email: read them at http://localhost:8025.

## Errors

- `EmailRejected`: the provider won't send it (a refused address, an
  unverified sender, a paused account). Retrying won't help.
- `EmailThrottled`: too fast, or the day's quota is used.
- `EmailUnavailable`: the provider couldn't be reached, or failed.

The providers' clients don't retry on their own: `retryTransient` retries
throttling and unavailability, after 1, 2, 4, … seconds. Neither SES nor
SMTP knows of idempotency: to send each email once, send it from something
that does, e.g. a cluster entity's persisted, deduplicated message.

## Testing

`@skjera/email/testing` is an outbox in memory: what was sent, to whom
(`to(address)`), and failures on cue (`failNext`).
