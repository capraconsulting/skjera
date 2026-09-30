import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { EventNotFound } from "./errors.ts";
import { DocumentId, PublishedEvent } from "./Model.ts";

// The public site's API: published content only, no login needed.

export class EventsApi extends HttpApiGroup.make("events").add(
  HttpApiEndpoint.get("list", "/api/events", {
    success: Schema.Array(PublishedEvent),
  }),
  HttpApiEndpoint.get("get", "/api/events/:id", {
    params: { id: DocumentId },
    success: PublishedEvent,
    error: EventNotFound,
  }),
) {}

/** For clients of the public API; servers add `EventsApi` to their own `HttpApi`. */
export class PublicApi extends HttpApi.make("public").add(EventsApi) {}
