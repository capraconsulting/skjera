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
import { formatDate } from "../../time.ts";
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
    <article className={styles.post}>
      <h1 className={styles.title}>{post.title}</h1>
      <p className={styles.meta}>
        <time dateTime={post.firstPublishedAt.toISOString()}>
          {formatDate(post.firstPublishedAt)}
        </time>
        {post.publishedAt.getTime() === post.firstPublishedAt.getTime()
          ? null
          : ` · Updated ${formatDate(post.publishedAt)}`}
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
    <p className={styles.missing}>
      {isRouteErrorResponse(error) && error.status === 404
        ? "This post doesn't exist, or isn't published."
        : "Something went wrong."}
    </p>
  );
}
