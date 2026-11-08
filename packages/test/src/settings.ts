import { execFileSync } from "node:child_process";

export type Env = Readonly<Record<string, string | undefined>>;

export const e2ePorts = [8806, 8805, 8804, 8803, 8802] as const;
export const dexPort = 5556;
export const mailpitApiUrl = "http://localhost:8025/api/v1";

export const composeServices = {
  documents: ["postgres", "rustfs"],
  email: ["mailpit"],
  server: ["postgres", "rustfs"],
  snapsync: ["postgres"],
} as const;

export const testServerBaseUrl = (env: Env): string => {
  const value = env.SKJERA_TEST_SERVER_URL;
  if (value === undefined || value === "") return "http://localhost";
  if (!/^https?:\/\/[A-Za-z0-9.-]+$/.test(value))
    throw new Error(
      `SKJERA_TEST_SERVER_URL must be http://<host> or https://<host>, without a port or path: ${value}`,
    );
  return value;
};

export const testServerOrigin = (env: Env, port: number): string =>
  new URL(`${testServerBaseUrl(env)}:${port}`).origin;

export const serviceUrl = (env: Env, port: number, path = ""): string => {
  const url = new URL(testServerOrigin(env, port));
  url.pathname = path;
  return url.href.replace(/\/$/, "");
};

export const testServerDexIssuerUrl = (env: Env): string =>
  serviceUrl(env, dexPort, "/dex");

export const dexIssuerUrl = (env: Env): string =>
  env.OAUTH_ISSUER || `http://localhost:${dexPort}/dex`;

export const dexDiscoveryUrl = (port = dexPort): string =>
  `http://localhost:${port}/dex/.well-known/openid-configuration`;

export const startComposeServices = (services: ReadonlyArray<string>): void => {
  execFileSync("docker", ["compose", "up", "--detach", "--wait", ...services], {
    cwd: new URL("../../..", import.meta.url),
    stdio: "inherit",
  });
};
