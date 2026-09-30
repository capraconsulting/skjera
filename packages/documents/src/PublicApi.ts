import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { PostNotFound } from "./errors.ts";
import { DocumentId, PublishedPost } from "./Model.ts";

// The public site's API: published content only, no login needed.

export class PostsApi extends HttpApiGroup.make("posts").add(
  HttpApiEndpoint.get("list", "/api/posts", {
    success: Schema.Array(PublishedPost),
  }),
  HttpApiEndpoint.get("get", "/api/posts/:id", {
    params: { id: DocumentId },
    success: PublishedPost,
    error: PostNotFound,
  }),
) {}

/** For clients of the public API; servers add `PostsApi` to their own `HttpApi`. */
export class PublicApi extends HttpApi.make("public").add(PostsApi) {}
