# OPS-01: Configuration, and starting without email

Skjera is configured by environment variables, as the [Readme](../../Readme.md#deploying) lists under «Deploying». Without the email settings it still starts, and logs emails instead of sending them.

**Set-up:** the development services running: `pnpm dev`. Where a test starts the server by hand, first stop the `server` process in `pnpm dev` (select it and press `x`), and start it again there when done.

## AC-1: The Readme lists the configuration

The Readme SHALL list the environment variables Skjera needs, and those it can do without.

**Test**

- **Given** the Readme
- **When** you read «Deploying»
- **Then** it names `DATABASE_URL`, `OAUTH_*`, `S3_*`, `SITE_URL`, `SITE_NAME`, `SITE_LOCALE`, `EMAIL_FROM`, `SIGNING_SECRET` and `EMAIL_TRANSPORT`, and says which may be left out

**Automated:** none

## AC-2: Email through SMTP

WHERE `EMAIL_TRANSPORT` is `smtp`, Skjera SHALL send its emails to the SMTP server at `EMAIL_SMTP_URL`.

**Test**

- **Given** `pnpm dev`, whose `mise.toml` sets `smtp` and Mailpit's address
- **When** a guest signs up to a public event
- **Then** the email arrives in Mailpit at http://localhost:8025

**Automated:** `packages/email/test/Email.test.tsx`

## AC-3: Email through SES

WHERE `EMAIL_TRANSPORT` is `ses`, Skjera SHALL send its emails through Amazon SES in `AWS_REGION`.

**Automated only:** it needs an AWS account. `packages/email/test/Email.test.tsx`

## AC-4: No email settings, emails logged

IF no way of sending email is set, THEN the server SHALL start, warn that emails are not sent, and log each email in place of sending it.

**Test**

- **Given** the server stopped in `pnpm dev`
- **When** you run `mise exec -- env -u EMAIL_TRANSPORT pnpm --filter @skjera/server dev`
- **Then** it starts, and logs «EMAIL_TRANSPORT not set: emails are logged, not sent»
- **When** a guest signs up to a public event
- **Then** nothing arrives in Mailpit, and the server logs «Email not sent (no transport configured)»

**Automated:** `packages/email/test/Email.test.tsx`

## AC-5: No signing secret, a warning

IF `SIGNING_SECRET` is not set, THEN the server SHALL start, and warn that guests' links in emails stop working when it restarts.

**Test**

- **Given** the server stopped in `pnpm dev`
- **When** you run `mise exec -- env -u SIGNING_SECRET pnpm --filter @skjera/server dev`
- **Then** it starts, and logs «SIGNING_SECRET not set: guests' links in emails stop working on restart»

**Automated:** `packages/documents/test/attendance/tokens.test.ts`
