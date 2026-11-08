import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  composeServices,
  dexPort,
  e2ePorts,
  mailpitApiUrl,
} from "@skjera/test";
import { describe, expect, it } from "vitest";
import { people } from "../../../server/testdata.ts";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("development configuration", () => {
  it("keeps every browser-test port in Dex's redirects (AC-1)", () => {
    const range = /range seq (\d+) (\d+)/.exec(read("dev/dex/config.yaml"));
    expect(range).not.toBeNull();
    const first = Number(range?.[1]);
    const last = Number(range?.[2]);
    expect(e2ePorts.every((port) => port >= first && port <= last)).toBe(true);
  });

  it("keeps package services in the CI checks job (AC-3)", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain(
      `docker compose up --detach --wait ${[...new Set(Object.values(composeServices).flat())].join(" ")}`,
    );
  });

  it("keeps Compose endpoints and host rules aligned (AC-5)", () => {
    const compose = read("compose.yml");
    const mise = read("mise.toml");
    expect(compose).toContain(`:${dexPort}:${dexPort}`);
    expect(compose).toContain(`:${new URL(mailpitApiUrl).port}:8025`);
    expect(compose).toContain("${" + "SERVICES_ADDRESS:-127.0.0.1}");
    expect(mise).toContain("SKJERA_TEST_SERVER_URL");
  });

  it("keeps Dex users equal to the server test people (AC-7)", () => {
    const dex = read("dev/dex/config.yaml");
    const users = people("http://localhost:5556/dex");
    for (const person of [users.alice, users.bob]) {
      expect(dex).toContain(`email: ${person.email}`);
      expect(dex).toContain(`username: ${person.name}`);
      const userId = new RegExp(
        `email: ${person.email}\\n\\s+username: ${person.name}\\n\\s+userID: ([^\\n]+)`,
      ).exec(dex)?.[1];
      expect(userId).toBeDefined();
      if (userId === undefined) throw new Error("Dex user has no id");
      expect(person.subject).toBe(
        Buffer.concat([
          Buffer.from([0x0a, userId.length]),
          Buffer.from(userId),
          Buffer.from([0x12, 5]),
          Buffer.from("local"),
        ]).toString("base64url"),
      );
    }
  });
});
