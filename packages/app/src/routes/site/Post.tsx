import type { DocumentId } from "@skjera/documents/api";
import { Effect } from "effect";
import {
  data,
  isRouteErrorResponse,
  type LoaderFunctionArgs,
  useLoaderData,
  useRouteError,
} from "react-router";
import { runPublic } from "../../site/client.ts";
import styles from "./Post.module.css";

export const postLoader = ({ params }: LoaderFunctionArgs) =>
  runPublic((client) =>
    client.posts.get({ params: { id: params.id as DocumentId } }).pipe(
      Effect.catchTag("PostNotFound", () =>
        Effect.sync(() => {
          throw data("Post not found", { status: 404 });
        }),
      ),
    ),
  );

export function Post() {
  const post = useLoaderData<typeof postLoader>();
  return (
    <article>
      <h1>{post.title}</h1>
      <p className={styles.meta}>
        Published{" "}
        <time dateTime={post.firstPublishedAt.toISOString()}>
          {post.firstPublishedAt.toLocaleDateString()}
        </time>
        {post.publishedAt.getTime() === post.firstPublishedAt.getTime()
          ? null
          : ` · updated ${post.publishedAt.toLocaleDateString()}`}
      </p>
      <div className={styles.body} data-testid="post-body">
        {post.body}
      </div>
    </article>
  );
}

export function PostError() {
  const error = useRouteError();
  return (
    <p>
      {isRouteErrorResponse(error) && error.status === 404
        ? "This post doesn't exist, or isn't published."
        : "Something went wrong."}
    </p>
  );
}
