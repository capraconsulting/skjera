import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { AwsClient } from "aws4fetch";
import { Config, Effect, Option, Redacted } from "effect";

/** Refreshes temporary AWS credentials for every operation on an existing bucket. */
export const s3 = Effect.gen(function* () {
  const awsRegion = yield* Config.String("AWS_REGION").pipe(
    Config.withDefault("us-east-1"),
  );
  const region = yield* Config.String("S3_REGION").pipe(
    Config.withDefault(awsRegion),
  );
  const endpoint = yield* Config.URL("S3_ENDPOINT").pipe(
    Config.withDefault(new URL(`https://s3.${region}.amazonaws.com`)),
  );
  const bucket = yield* Config.String("S3_BUCKET");
  const accessKeyId = yield* Config.option(Config.String("S3_ACCESS_KEY_ID"));
  const secretAccessKey = yield* Config.option(
    Config.Redacted("S3_SECRET_ACCESS_KEY"),
  );
  const sessionToken = yield* Config.option(
    Config.Redacted("S3_SESSION_TOKEN"),
  );
  if (
    Option.isSome(accessKeyId) !== Option.isSome(secretAccessKey) ||
    (Option.isSome(sessionToken) && Option.isNone(accessKeyId))
  ) {
    return yield* Effect.die(
      new Error(
        "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use AWS credentials. S3_SESSION_TOKEN requires both keys.",
      ),
    );
  }
  // The SDK caches and refreshes temporary credentials, including EKS Pod
  // Identity. Resolve for each request; never freeze its initial result.
  const credentials =
    Option.isSome(accessKeyId) && Option.isSome(secretAccessKey)
      ? async () => ({
          accessKeyId: accessKeyId.value,
          secretAccessKey: Redacted.value(secretAccessKey.value),
          ...(Option.isSome(sessionToken)
            ? { sessionToken: Redacted.value(sessionToken.value) }
            : {}),
        })
      : defaultProvider();
  const cache = new Map<string, ArrayBuffer>();
  // Path-style addressing also supports local S3-compatible stores.
  const url = (key = "") =>
    new URL(`${bucket}/${key}`, endpoint.href.replace(/\/?$/, "/")).href;
  const fetch = async (target: string, init?: RequestInit) => {
    const client = new AwsClient({
      ...(await credentials()),
      region,
      service: "s3",
      cache,
    });
    return client.fetch(target, init);
  };
  const request = (target: string, init?: RequestInit) =>
    Effect.tryPromise((signal) => fetch(target, { ...init, signal })).pipe(
      Effect.orDie,
    );

  // Crossplane owns cloud buckets. This opt-in is only for local RustFS.
  const createBucket = yield* Config.Boolean("S3_CREATE_BUCKET").pipe(
    Config.withDefault(false),
  );
  if (createBucket) {
    const created = yield* request(url(), { method: "PUT" });
    if (!created.ok && created.status !== 409) {
      return yield* Effect.die(
        new Error(
          `Creating bucket ${bucket} failed: ${created.status} ${yield* Effect.promise(() => created.text())}`,
        ),
      );
    }
  }

  return { request, fetch, url };
});
