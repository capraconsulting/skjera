import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assert, describe, it } from "@effect/vitest";
import { mailpitApiUrl } from "@skjera/test";
import { ConfigProvider, Effect, Exit, Layer, Redacted } from "effect";
import { simpleParser } from "mailparser";
import { Body, Button, Heading, Html, Text } from "react-email";
import {
  Email,
  EmailRejected,
  EmailThrottled,
  EmailUnavailable,
  type Message,
  retryTransient,
  toMime,
} from "../src/Email.ts";
import { layerConfig } from "../src/index.ts";
import { renderEmail } from "../src/react.ts";
import { makeSes } from "../src/ses.ts";
import { makeSmtp } from "../src/smtp.ts";
import * as EmailTest from "../src/testing.ts";

const calendar = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Skjera//Test//EN",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:launch@skjera.test",
  "DTSTAMP:20261006T120000Z",
  "DTSTART;TZID=Europe/Oslo:20261015T180000",
  "DTEND;TZID=Europe/Oslo:20261015T210000",
  "SUMMARY:Launch",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const message = (subject: string): Message => ({
  from: { name: "Skjera", address: "events@skjera.test" },
  to: "alice@example.com",
  cc: [{ name: "Bob", address: "bob@example.com" }],
  bcc: "organizers@skjera.test",
  replyTo: "organizers@skjera.test",
  subject,
  text: "You're signed up for Launch.",
  html: "<p>You're signed up for <b>Launch</b>.</p>",
  attachments: [
    {
      filename: "agenda.txt",
      content: "18:00 Doors",
      contentType: "text/plain",
    },
  ],
  calendar: { method: "REQUEST", content: calendar },
});

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

/** What SES's client sends to send an email. */
interface SesRequest {
  readonly FromEmailAddress: string;
  readonly Destination: Record<string, ReadonlyArray<string>>;
  readonly Content: { readonly Raw: { readonly Data: string } };
}

/** A server playing SES's API, answering with `replies` in turn. */
const fakeSes = (
  replies: ReadonlyArray<{
    readonly status: number;
    readonly type?: string;
    readonly body: unknown;
  }>,
) =>
  Effect.acquireRelease(
    Effect.callback<{
      readonly url: string;
      readonly received: Array<{
        readonly path: string;
        readonly body: SesRequest;
      }>;
      readonly close: () => void;
    }>((resume) => {
      const received: Array<{ path: string; body: SesRequest }> = [];
      const server = createServer((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          received.push({ path: request.url ?? "", body: JSON.parse(body) });
          const reply = replies[Math.min(received.length, replies.length) - 1];
          response.writeHead(reply?.status ?? 500, {
            "content-type": "application/json",
            ...(reply?.type === undefined
              ? {}
              : { "x-amzn-errortype": reply.type }),
          });
          response.end(JSON.stringify(reply?.body ?? {}));
        });
      });
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        resume(
          Effect.succeed({
            url: `http://127.0.0.1:${port}`,
            received,
            close: () => server.close(),
          }),
        );
      });
    }),
    (fake) => Effect.sync(fake.close),
  );

const sesAt = (endpoint: string) =>
  makeSes({
    region: "eu-north-1",
    endpoint,
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
  });

/** Mailpit's API, from compose.yml. */
const mailpit = (path: string, init?: RequestInit) =>
  Effect.promise(() =>
    fetch(`${mailpitApiUrl}${path}`, init).then((response) =>
      response.headers.get("content-type")?.includes("json")
        ? response.json()
        : response.text(),
    ),
  );

describe("Email", () => {
  it.effect(
    "builds one MIME message: alternatives, attachments, invitation",
    () =>
      Effect.gen(function* () {
        const raw = decode(yield* toMime(message("Launch")));
        const parsed = yield* Effect.promise(() => simpleParser(raw));
        assert.strictEqual(parsed.subject, "Launch");
        assert.strictEqual(parsed.text?.trim(), "You're signed up for Launch.");
        assert.include(parsed.html || "", "<b>Launch</b>");
        assert.deepStrictEqual(
          (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(
            (to) => to?.value.map((each) => each.address) ?? [],
          ),
          ["alice@example.com"],
        );
        assert.strictEqual(
          (Array.isArray(parsed.cc) ? parsed.cc[0] : parsed.cc)?.value[0]?.name,
          "Bob",
        );
        // Bcc stays out of what everyone gets.
        assert.notInclude(raw, "organizers@skjera.test\r\nBcc");
        assert.notMatch(raw, /^Bcc:/m);
        assert.include(
          parsed.attachments.map((each) => each.filename).join(),
          "agenda.txt",
        );
        // The invitation: what mail clients offer to put in calendars.
        assert.match(raw, /Content-Type: text\/calendar; .*method=REQUEST/);
        assert.include(raw, "SUMMARY:Launch");
      }),
  );

  it.effect("renders React Email templates to HTML and plain text", () =>
    Effect.gen(function* () {
      const rendered = yield* renderEmail(
        <Html lang="en">
          <Body>
            <Heading>You're signed up</Heading>
            <Text>Launch starts Thursday at 18:00.</Text>
            <Button href="https://skjera.test/events/1">See the event</Button>
          </Body>
        </Html>,
      );
      assert.include(rendered.html, "<!DOCTYPE html");
      assert.include(rendered.html, 'href="https://skjera.test/events/1"');
      assert.include(rendered.text, "YOU'RE SIGNED UP");
      assert.include(rendered.text, "Launch starts Thursday at 18:00.");
      assert.include(rendered.text, "https://skjera.test/events/1");
    }),
  );
});

describe("SES", () => {
  it.effect("sends the message raw, to every recipient", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSes([
        { status: 200, body: { MessageId: "ses-message-1" } },
      ]);
      const sent = yield* sesAt(fake.url).send(message("Launch"));
      assert.deepStrictEqual(sent, { id: "ses-message-1" });
      const [request] = fake.received;
      assert.strictEqual(request?.path, "/v2/email/outbound-emails");
      assert.deepStrictEqual(request?.body.Destination, {
        ToAddresses: ["alice@example.com"],
        CcAddresses: ["bob@example.com"],
        BccAddresses: ["organizers@skjera.test"],
      });
      assert.strictEqual(request?.body.FromEmailAddress, "events@skjera.test");
      const raw = Buffer.from(
        request?.body.Content.Raw.Data ?? "",
        "base64",
      ).toString();
      assert.include(raw, "Subject: Launch");
      assert.include(raw, "method=REQUEST");
    }).pipe(Effect.scoped),
  );

  it.effect("fails as SES says: refused, too fast, or failing", () =>
    Effect.gen(function* () {
      const fake = yield* fakeSes([
        {
          status: 400,
          type: "MessageRejected",
          body: { message: "Email address is not verified." },
        },
        {
          status: 429,
          type: "TooManyRequestsException",
          body: { message: "Maximum sending rate exceeded." },
        },
        { status: 500, type: "InternalServiceErrorException", body: {} },
      ]);
      const send = Effect.flip(sesAt(fake.url).send(message("Launch")));
      assert.instanceOf(yield* send, EmailRejected);
      assert.instanceOf(yield* send, EmailThrottled);
      assert.instanceOf(yield* send, EmailUnavailable);
      // Each was tried once: AWS's client doesn't retry on its own.
      assert.strictEqual(fake.received.length, 3);
    }).pipe(Effect.scoped),
  );

  it.effect("is unavailable when it can't be reached", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        sesAt("http://127.0.0.1:9").send(message("Launch")),
      );
      assert.instanceOf(error, EmailUnavailable);
    }),
  );
});

describe("SMTP", () => {
  it.effect("delivers to Mailpit, invitation and all", () =>
    Effect.gen(function* () {
      const subject = `Launch ${crypto.randomUUID()}`;
      const smtp = makeSmtp(Redacted.make("smtp://localhost:1025"));
      yield* smtp.send(message(subject));

      const found = (yield* mailpit(
        `/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
      )) as { messages: ReadonlyArray<{ ID: string }> };
      const id = found.messages[0]?.ID ?? "";
      yield* Effect.addFinalizer(() =>
        Effect.ignore(
          mailpit("/messages", {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ IDs: [id] }),
          }),
        ),
      );
      const raw = (yield* mailpit(`/message/${id}/raw`)) as string;
      const parsed = yield* Effect.promise(() => simpleParser(raw));
      assert.strictEqual(parsed.subject, subject);
      assert.include(raw, "method=REQUEST");
      // Mailpit got it for the bcc recipient too. (It notes so in the copy
      // it keeps; what was sent has no Bcc header: see the MIME test.)
      const detail = (yield* mailpit(`/message/${id}`)) as {
        Bcc: ReadonlyArray<{ Address: string }>;
      };
      assert.deepStrictEqual(
        detail.Bcc.map((each) => each.Address),
        ["organizers@skjera.test"],
      );
    }).pipe(Effect.scoped),
  );

  it.effect("is unavailable when the server can't be reached", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        makeSmtp(Redacted.make("smtp://127.0.0.1:9")).send(message("Launch")),
      );
      assert.instanceOf(error, EmailUnavailable);
    }),
  );
});

describe("EmailTest", () => {
  it.live("keeps what was sent; retries what may work later", () =>
    Effect.gen(function* () {
      const outbox = EmailTest.make();
      outbox.failNext(new EmailThrottled({ reason: "Too fast" }));
      outbox.failNext(new EmailUnavailable({ reason: "Down" }));
      const sent = yield* outbox.email
        .send(message("Launch"))
        .pipe(retryTransient({ base: "10 millis" }));
      assert.strictEqual(sent.id, "test-1");
      assert.deepStrictEqual(outbox.to("Bob@Example.com").length, 1);
      assert.deepStrictEqual(outbox.sent()[0]?.recipients, [
        "alice@example.com",
        "bob@example.com",
        "organizers@skjera.test",
      ]);

      // A rejection isn't retried.
      outbox.failNext(new EmailRejected({ reason: "Not verified" }));
      const refused = yield* outbox.email
        .send(message("Again"))
        .pipe(retryTransient({ base: "10 millis" }), Effect.exit);
      assert.isTrue(Exit.isFailure(refused));
      assert.strictEqual(outbox.sent().length, 1);
    }),
  );
});

describe("layerConfig", () => {
  const configured = (env: Record<string, string>) =>
    layerConfig.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    );

  it.effect("logs emails, not sends them, when none is configured", () =>
    Effect.gen(function* () {
      for (const env of [{}, { EMAIL_TRANSPORT: "smtp" }]) {
        const sent = yield* Effect.gen(function* () {
          return yield* (yield* Email).send(message("Launch"));
        }).pipe(Effect.provide(configured(env)));
        assert.strictEqual(sent.id, "log-1");
      }
    }),
  );
});
