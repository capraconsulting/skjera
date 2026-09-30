import { Effect } from "effect";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { DocumentsClient, runtime } from "../documents/client.ts";

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
  return redirect(`/posts/${id}`);
};

export function Posts() {
  const posts = useLoaderData<typeof postsLoader>();
  return (
    <>
      <div className="toolbar">
        <h1>Posts</h1>
        <Form method="post">
          <button type="submit">New post</button>
        </Form>
      </div>
      {posts.length === 0 ? (
        <p>No posts yet.</p>
      ) : (
        <ul className="list">
          {posts.map((post) => (
            <li key={post.id}>
              <Link to={`/posts/${post.id}`}>
                {post.title.trim() === "" ? "Untitled" : post.title}
              </Link>{" "}
              <span className="badge">
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
