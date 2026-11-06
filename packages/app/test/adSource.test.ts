import { adSourceValueLength } from "@skjera/documents/api";
import { describe, expect, it } from "vitest";
import {
  adSourceFor,
  adSourceFrom,
  rememberAdSource,
} from "../src/site/adSource.ts";

/** A storage kept in a map. */
const storageOf = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
};

/** A storage where site data is blocked: every use throws. */
const blocked = (): Storage => {
  const fail = () => {
    throw new Error("The operation is insecure.");
  };
  return {
    get length(): number {
      return fail();
    },
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
};

const event = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

describe("adSourceFrom", () => {
  it("reads the seven names, trimmed, and leaves out a blank one and any other name (AC-1)", () => {
    expect(
      adSourceFrom("?utm_source=%20LinkedIn%20&utm_medium=&gclid=x&fbclid=F"),
    ).toEqual({ utm_source: "LinkedIn", fbclid: "F" });
    expect(
      adSourceFrom(
        "utm_source=a&utm_medium=b&utm_campaign=c&utm_content=d&utm_term=e&li_fat_id=f&fbclid=g",
      ),
    ).toEqual({
      utm_source: "a",
      utm_medium: "b",
      utm_campaign: "c",
      utm_content: "d",
      utm_term: "e",
      li_fat_id: "f",
      fbclid: "g",
    });
  });

  it("keeps the first 500 characters of a longer value (AC-1)", () => {
    const term = adSourceFrom(`?utm_term=${"x".repeat(600)}`)?.utm_term;
    expect(adSourceValueLength).toBe(500);
    expect(term).toBe("x".repeat(500));
  });

  it("gives no source for an address with none of the seven (AC-1)", () => {
    expect(adSourceFrom("")).toBeUndefined();
    expect(adSourceFrom("?guest=1&token=abc&gclid=x")).toBeUndefined();
    expect(adSourceFrom("?utm_source=%20%20")).toBeUndefined();
  });
});

describe("rememberAdSource and adSourceFor", () => {
  it("keeps what an address had, for that event alone (AC-1)", () => {
    const storage = storageOf();
    rememberAdSource(event, "?utm_source=linkedin&li_fat_id=abc", storage);
    expect(adSourceFor(event, storage)).toEqual({
      utm_source: "linkedin",
      li_fat_id: "abc",
    });
    expect(adSourceFor(other, storage)).toBeUndefined();
  });

  it("keeps the values when the page is opened again without any of the seven (AC-1)", () => {
    const storage = storageOf();
    rememberAdSource(event, "?utm_source=linkedin", storage);
    rememberAdSource(event, "", storage);
    rememberAdSource(event, "?gclid=x", storage);
    expect(adSourceFor(event, storage)).toEqual({ utm_source: "linkedin" });
  });

  it("replaces all the kept values at once when an address has any, so two ads never mix (AC-1)", () => {
    const storage = storageOf();
    rememberAdSource(
      event,
      "?utm_source=linkedin&utm_campaign=spring&li_fat_id=abc",
      storage,
    );
    rememberAdSource(event, "?utm_source=meta", storage);
    expect(adSourceFor(event, storage)).toEqual({ utm_source: "meta" });
  });

  it("gives undefined for something kept that is not a source (AC-1)", () => {
    const storage = storageOf();
    storage.setItem(`skjera-ad-source-${event}`, "not json");
    expect(adSourceFor(event, storage)).toBeUndefined();
    storage.setItem(`skjera-ad-source-${event}`, '{"utm_source":7}');
    expect(adSourceFor(event, storage)).toBeUndefined();
  });

  it("throws nothing and keeps nothing where site data is blocked (AC-1)", () => {
    const storage = blocked();
    expect(() =>
      rememberAdSource(event, "?utm_source=linkedin", storage),
    ).not.toThrow();
    expect(adSourceFor(event, storage)).toBeUndefined();
  });
});
