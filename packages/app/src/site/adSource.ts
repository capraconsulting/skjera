import {
  AdSource,
  adSourceKeys,
  adSourceValueLength,
} from "@skjera/documents/api";
import { Option, Schema } from "effect";

// Which ad someone came from, as the address of an event's page says. It is
// kept in the browser for that event, whatever the visitor said about
// cookies, and goes with the sign-up. This file reads no cookie choice and
// imports nothing that reads `window.location`, so it runs in Node too.

const decodeAdSource = Schema.decodeUnknownOption(AdSource);

const key = (eventId: string) => `skjera-ad-source-${eventId}`;

/**
 * The values an address's query has for the names that say which ad it came
 * from, each trimmed and cut to `adSourceValueLength` characters, a blank one
 * left out; undefined when none is left. Other names are ignored.
 */
export const adSourceFrom = (search: string): AdSource | undefined => {
  const params = new URLSearchParams(search);
  const found: Record<string, string> = {};
  for (const name of adSourceKeys) {
    const value = params.get(name)?.trim().slice(0, adSourceValueLength);
    if (value !== undefined && value !== "") found[name] = value;
  }
  return Object.keys(found).length === 0 ? undefined : found;
};

/**
 * Keeps what `search` says of the ad for the event. Any of the values
 * REPLACES all that was kept, so two ads' values never mix; an address
 * without any keeps what is kept.
 */
export const rememberAdSource = (
  eventId: string,
  search: string,
  storage?: Storage,
) => {
  const source = adSourceFrom(search);
  if (source === undefined) return;
  try {
    (storage ?? localStorage).setItem(key(eventId), JSON.stringify(source));
  } catch {
    // Site data blocked: the sign-up goes on without the source.
  }
};

/** What is kept of the ad for the event: undefined when nothing, or nothing valid. */
export const adSourceFor = (
  eventId: string,
  storage?: Storage,
): AdSource | undefined => {
  try {
    const stored = (storage ?? localStorage).getItem(key(eventId));
    if (stored === null) return undefined;
    const decoded = decodeAdSource(JSON.parse(stored));
    return Option.isSome(decoded) ? decoded.value : undefined;
  } catch {
    return undefined;
  }
};
