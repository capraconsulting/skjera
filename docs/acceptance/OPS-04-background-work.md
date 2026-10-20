# OPS-04: Background work delivered once

Emails, reminders and other work that follows a change run in the background, as messages the server keeps in the database. Each is delivered once and in order, survives a restart, and is tried again when it fails.

**Set-up:** `pnpm dev` running, and a public event open to guests.

## AC-1: Each message once

Skjera SHALL deliver each background message once, however often it is sent.

**Test**

- **Given** the event open in a private window
- **When** a guest signs up
- **Then** Mailpit at http://localhost:8025 has one email to the guest, not two

**Automated:** `packages/documents/test/server/Cluster.test.ts`

## AC-2: In order, for each event

Skjera SHALL handle the messages for one event one at a time, in the order they were sent.

**Automated only:** two messages for one event can't be raced by hand. `packages/documents/test/server/Cluster.test.ts`

## AC-3: Only what was saved

IF the change that sends a message is not saved in the end, THEN Skjera SHALL not deliver the message.

**Automated only:** a change that fails after sending its message can't be made by hand. `packages/documents/test/server/Cluster.test.ts`

## AC-4: Tried again when it fails

IF sending an email fails because the email server can't be reached, THEN Skjera SHALL try again, and send it once the email server answers.

**Test**

- **Given** Mailpit stopped: `docker compose stop mailpit`
- **When** a guest signs up to the event
- **And** you start Mailpit again within half a minute: `docker compose start mailpit`
- **Then** the guest's email arrives in Mailpit, once

**Automated:** `packages/email/test/Email.test.tsx`, `packages/documents/test/server/Cluster.test.ts`

## AC-5: Kept through a restart

WHEN the server restarts before a message is delivered, Skjera SHALL deliver it after the restart.

**Test**

- **Given** Mailpit stopped: `docker compose stop mailpit`
- **When** a guest signs up to the event
- **And** you restart the `server` process in `pnpm dev` (select it and press `r`), then start Mailpit: `docker compose start mailpit`
- **Then** the guest's email arrives in Mailpit, once

**Automated:** `packages/documents/test/server/Cluster.test.ts`
