import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect, Option } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Images } from "../../src/events/images/Images.ts";

const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const setup = async () => {
  const directory = await mkdtemp(join(tmpdir(), "skjera-images-"));
  const tokenFile = join(directory, "pod-token");
  const configFile = join(directory, "config");
  const credentialsFile = join(directory, "credentials");
  await Promise.all([
    writeFile(tokenFile, "pod-authorization-1", { mode: 0o600 }),
    writeFile(configFile, "", { mode: 0o600 }),
    writeFile(credentialsFile, "", { mode: 0o600 }),
  ]);
  // Never read the developer's credentials, profiles, login or IMDS endpoint.
  for (const key of [
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_CREDENTIAL_EXPIRATION",
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_ROLE_ARN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("AWS_CONFIG_FILE", configFile);
  vi.stubEnv("AWS_SHARED_CREDENTIALS_FILE", credentialsFile);
  vi.stubEnv("AWS_EC2_METADATA_DISABLED", "true");
  const identity = {
    version: 1,
    authorization: "pod-authorization-1",
    status: 200,
  };
  const metadata: IncomingHttpHeaders[] = [];
  const requests: Array<{
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
  }> = [];
  const objects = new Map<string, { body: Buffer; type: string }>();
  const server = createServer((request, response) => {
    if (request.url === "/credentials") {
      metadata.push(request.headers);
      response.writeHead(
        request.headers.authorization === identity.authorization
          ? identity.status
          : 403,
        { "Content-Type": "application/json" },
      );
      response.end(
        JSON.stringify({
          AccessKeyId: `pod-access-key-${identity.version}`,
          SecretAccessKey: `pod-secret-${identity.version}`,
          Token: `pod-session-${identity.version}`,
          Expiration: new Date(Date.now() + 10 * 60_000).toISOString(),
        }),
      );
      return;
    }
    const path = request.url ?? "/";
    const method = request.method ?? "GET";
    requests.push({ method, path, headers: request.headers });
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (method === "PUT" && path === "/images/") {
        response.writeHead(409).end();
      } else if (method === "PUT") {
        objects.set(path, {
          body: Buffer.concat(chunks),
          type: request.headers["content-type"] ?? "application/octet-stream",
        });
        response.writeHead(200).end();
      } else {
        const object = objects.get(path);
        if (object === undefined) response.writeHead(404).end();
        else
          response
            .writeHead(200, {
              "Content-Type": object.type,
              "Content-Length": object.body.length,
            })
            .end(object.body);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  vi.stubEnv("AWS_CONTAINER_CREDENTIALS_FULL_URI", `${endpoint}/credentials`);
  vi.stubEnv("AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", tokenFile);
  return {
    directory,
    tokenFile,
    server,
    endpoint,
    requests,
    metadata,
    identity,
  };
};

let fixture: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  fixture = await setup();
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    fixture.server.close((error) => (error ? reject(error) : resolve())),
  );
  await rm(fixture.directory, { recursive: true, force: true });
});

const makeImages = (settings: Record<string, string> = {}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* Images;
    }).pipe(
      Effect.provide(Images.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            S3_BUCKET: "images",
            S3_ENDPOINT: fixture.endpoint,
            AWS_REGION: "eu-north-1",
            ...settings,
          }),
        ),
      ),
    ),
  );

const readBack = async (images: Images["Service"], id: string) => {
  const result = await Effect.runPromise(images.get(id));
  expect(Option.isSome(result)).toBe(true);
  if (Option.isSome(result)) {
    expect(result.value.contentType).toBe("image/png");
    expect(
      Buffer.from(await new Response(result.value.body).arrayBuffer()),
    ).toEqual(Buffer.from(png));
  }
};

describe("Images AWS credentials", () => {
  it("uses existing buckets and refreshes Pod Identity credentials and projected tokens", async () => {
    const images = await makeImages();
    expect(fixture.requests).toHaveLength(0);
    expect(fixture.metadata).toHaveLength(0);
    const { id } = await Effect.runPromise(images.upload(png));
    await readBack(images, id);
    expect(fixture.metadata).toHaveLength(1);
    expect(fixture.metadata[0]?.authorization).toBe("pod-authorization-1");
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "Credential=pod-access-key-1/",
    );
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "/eu-north-1/s3/aws4_request",
    );
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "x-amz-security-token",
    );
    expect(fixture.requests[0]?.headers["x-amz-security-token"]).toBe(
      "pod-session-1",
    );

    fixture.identity.version = 2;
    fixture.identity.authorization = "pod-authorization-2";
    await writeFile(fixture.tokenFile, fixture.identity.authorization);
    // Advance only Date; network timers remain real. The cached STS session
    // has expired, so the same Images service must obtain fresh credentials.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60_000);
    await readBack(images, id);
    expect(fixture.metadata).toHaveLength(2);
    expect(fixture.metadata[1]?.authorization).toBe("pod-authorization-2");
    expect(fixture.requests[2]?.headers.authorization).toContain(
      "Credential=pod-access-key-2/",
    );
    expect(fixture.requests[2]?.headers["x-amz-security-token"]).toBe(
      "pod-session-2",
    );
    expect(
      fixture.requests.every((request) => request.path !== "/images/"),
    ).toBe(true);
  });

  it("uses the standard AWS environment credential chain, including its session token", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "aws-env-access");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "aws-env-secret");
    vi.stubEnv("AWS_SESSION_TOKEN", "aws-env-session");
    const images = await makeImages();
    const { id } = await Effect.runPromise(images.upload(png));
    await readBack(images, id);
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "Credential=aws-env-access/",
    );
    expect(fixture.requests[0]?.headers["x-amz-security-token"]).toBe(
      "aws-env-session",
    );
    expect(fixture.metadata).toHaveLength(0);
  });

  it("keeps explicit S3 credentials separate from AWS credentials and supports session tokens", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "unused-aws-access");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "unused-aws-secret");
    const images = await makeImages({
      S3_ACCESS_KEY_ID: "local-access",
      S3_SECRET_ACCESS_KEY: "local-secret",
      S3_SESSION_TOKEN: "local-session",
      S3_REGION: "us-east-1",
    });
    await Effect.runPromise(images.upload(png));
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "Credential=local-access/",
    );
    expect(fixture.requests[0]?.headers.authorization).toContain(
      "/us-east-1/s3/aws4_request",
    );
    expect(fixture.requests[0]?.headers["x-amz-security-token"]).toBe(
      "local-session",
    );
    expect(fixture.metadata).toHaveLength(0);
  });

  it("creates a local bucket only when explicitly enabled", async () => {
    await makeImages({
      S3_ACCESS_KEY_ID: "local-access",
      S3_SECRET_ACCESS_KEY: "local-secret",
      S3_CREATE_BUCKET: "true",
    });
    expect(fixture.requests).toHaveLength(1);
    expect(fixture.requests[0]?.method).toBe("PUT");
    expect(fixture.requests[0]?.path).toBe("/images/");
    expect(fixture.metadata).toHaveLength(0);
  });

  it.each([
    { S3_ACCESS_KEY_ID: "incomplete-access" },
    { S3_SECRET_ACCESS_KEY: "incomplete-secret" },
    { S3_SESSION_TOKEN: "orphaned-session" },
  ])(
    "rejects incomplete explicit credentials instead of falling back to a role",
    async (settings) => {
      await expect(makeImages(settings)).rejects.toThrow(
        "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY",
      );
      expect(fixture.metadata).toHaveLength(0);
      expect(fixture.requests).toHaveLength(0);
    },
  );

  it("does not send an S3 request when role credentials cannot be obtained", async () => {
    fixture.identity.status = 403;
    const images = await makeImages();
    await expect(Effect.runPromise(images.upload(png))).rejects.toThrow();
    expect(fixture.metadata.length).toBeGreaterThan(0);
    expect(fixture.requests).toHaveLength(0);
  });
});
