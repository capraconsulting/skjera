import { Effect } from "effect";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { Toolbar } from "../../components/Toolbar.tsx";
import { DocumentsClient, runtime } from "../../documents/client.ts";
import styles from "./Posts.module.css";

export const postsLoader = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* DocumentsClient;
      return yield* client.ListDocuments({ type: "post" });
    }),
  );

export const createPostAction = async () => {
  const id = await runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* DocumentsClient;
      return yield* client.CreateDocument({ type: "post" });
    }),
  );
  return redirect(`/studio/posts/${id}`);
};

export function Posts() {
  const posts = useLoaderData<typeof postsLoader>();
  return (
    <>
      <Toolbar>
        <h1>Posts</h1>
        <Form method="post">
          <button type="submit">New post</button>
        </Form>
      </Toolbar>
      {posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul className={styles.list}>
          {posts.map((post) => (
            <li key={post.id}>
              <Link to={`/studio/posts/${post.id}`}>
                {post.title.trim() === "" ? "Untitled" : post.title}
              </Link>{" "}
              <span className={styles.badge}>
                {post.publishedAt === null
                  ? "Draft"
                  : post.hasUnpublishedChanges
                    ? "Changed since published"
                    : "Published"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
