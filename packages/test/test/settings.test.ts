import { describe, expect, it } from "vitest";
import { dexIssuerUrl, testServerOrigin } from "../src/settings.ts";

describe("test settings", () => {
  it("builds and validates the shared test-server origin (AC-2)", () => {
    expect(testServerOrigin({}, 8802)).toBe("http://localhost:8802");
    expect(
      testServerOrigin(
        { SKJERA_TEST_SERVER_URL: "https://tests.example" },
        8803,
      ),
    ).toBe("https://tests.example:8803");
    expect(() =>
      testServerOrigin(
        { SKJERA_TEST_SERVER_URL: "http://localhost/path" },
        8802,
      ),
    ).toThrow("without a port or path");
  });

  it("uses OAUTH_ISSUER for the OAuth demo when the test-server address differs (AC-5)", () => {
    expect(
      dexIssuerUrl({
        OAUTH_ISSUER: "http://localhost:5556/dex",
        SKJERA_TEST_SERVER_URL: "http://192.168.1.10",
      }),
    ).toBe("http://localhost:5556/dex");
  });
});
