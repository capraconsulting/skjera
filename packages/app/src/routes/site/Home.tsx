import { Link, useLoaderData } from "react-router";
import { runPublic } from "../../site/client.ts";
import styles from "./Home.module.css";

export const homeLoader = () => runPublic((client) => client.posts.list());

const excerpt = (body: string) =>
  body.length > 200 ? `${body.slice(0, 200).trimEnd()}…` : body;

export function Home() {
  const posts = useLoaderData<typeof homeLoader>();
  return (
    <>
      <h1>Posts</h1>
      {posts.length === 0 ? (
        <p>Nothing has been published yet.</p>
      ) : (
        posts.map((post) => (
          <article key={post.id} className={styles.teaser}>
            <h2>
              <Link to={`/posts/${post.id}`}>{post.title}</Link>
            </h2>
            <time
              className={styles.date}
              dateTime={post.firstPublishedAt.toISOString()}
            >
              {post.firstPublishedAt.toLocaleDateString()}
            </time>
            <p>{excerpt(post.body)}</p>
          </article>
        ))
      )}
    </>
  );
}
