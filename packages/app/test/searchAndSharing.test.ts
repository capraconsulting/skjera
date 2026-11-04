import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// What search engines and sharing services read from the built app's files:
// robots.txt, and the link to the web app manifest in index.html.

const publicFile = (name: string) =>
  readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");

interface Group {
  readonly agents: ReadonlyArray<string>;
  readonly rules: ReadonlyArray<{
    readonly allow: boolean;
    readonly path: string;
  }>;
}

/** robots.txt as a crawler reads it: groups of user agents with their rules. */
const groupsOf = (text: string): ReadonlyArray<Group> => {
  const groups: Array<{
    agents: Array<string>;
    rules: Array<{ allow: boolean; path: string }>;
  }> = [];
  let open = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    switch (field?.trim().toLowerCase()) {
      case "user-agent":
        if (!open) groups.push({ agents: [], rules: [] });
        open = true;
        groups.at(-1)?.agents.push(value.toLowerCase());
        break;
      case "allow":
      case "disallow":
        open = false;
        if (value !== "") {
          groups.at(-1)?.rules.push({
            allow: field?.trim().toLowerCase() === "allow",
            path: value,
          });
        }
        break;
    }
  }
  return groups;
};

/** Whether `crawler` may fetch `path`: its own group, else `*`; the longest rule wins, Allow on a tie. */
const mayFetch = (text: string, crawler: string, path: string): boolean => {
  const groups = groupsOf(text);
  const group =
    groups.find((g) => g.agents.includes(crawler.toLowerCase())) ??
    groups.find((g) => g.agents.includes("*"));
  const matching = (group?.rules ?? [])
    .filter((rule) => path.startsWith(rule.path))
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return matching[0]?.allow ?? true;
};

const eventPage = "/events/0b7a5c1e-3f2d-4c3a-9d0e-5a1b2c3d4e5f";

describe("robots.txt", () => {
  it("keeps search engines from the event pages but not the rest (AC-1)", () => {
    const robots = publicFile("robots.txt");
    for (const crawler of ["Googlebot", "Bingbot"]) {
      expect(mayFetch(robots, crawler, eventPage), crawler).toBe(false);
      expect(mayFetch(robots, crawler, "/"), crawler).toBe(true);
    }
  });

  it("lets the crawlers that make sharing previews fetch the event pages (AC-1)", () => {
    const robots = publicFile("robots.txt");
    for (const crawler of [
      "LinkedInBot",
      "Slackbot-LinkExpanding",
      "facebookexternalhit",
      "SkypeUriPreview",
    ]) {
      expect(mayFetch(robots, crawler, eventPage), crawler).toBe(true);
    }
  });
});

describe("index.html", () => {
  it("links the web app manifest (AC-2)", () => {
    const html = readFileSync(
      new URL("../index.html", import.meta.url),
      "utf8",
    );
    expect(html).toMatch(
      /<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/?>/,
    );
  });
});
