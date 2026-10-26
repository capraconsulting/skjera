import { describe, expect, it } from "vitest";
import { wantsSmallLogo } from "../src/components/smallLogo.ts";

const safari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const chromeOnIPad =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const chrome =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const firefox =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";

describe("wantsSmallLogo", () => {
  it("is Safari, and every browser on an iPhone or iPad", () => {
    for (const userAgent of [safari, iPhone, chromeOnIPad]) {
      expect(wantsSmallLogo(userAgent), userAgent).toBe(true);
    }
  });

  it("is not Chrome or Firefox on a computer", () => {
    for (const userAgent of [chrome, firefox]) {
      expect(wantsSmallLogo(userAgent), userAgent).toBe(false);
    }
  });
});
