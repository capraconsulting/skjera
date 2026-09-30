import { Link, useLoaderData } from "react-router";
import { runPublic } from "../../site/client.ts";
import { formatDate } from "../../time.ts";
import styles from "./Home.module.css";

export const homeLoader = () => runPublic((client) => client.posts.list());

const excerpt = (body: string) =>
  body.length > 200 ? `${body.slice(0, 200).trimEnd()}…` : body;

export function Home() {
  const posts = useLoaderData<typeof homeLoader>();
  return (
    <div className={styles.home}>
      <h1 className={styles.heading}>Posts</h1>
      {posts.length === 0 ? (
        <p className={styles.empty}>Nothing has been published yet.</p>
      ) : (
        <div className={styles.list}>
          {posts.map((post) => (
            <article key={post.id} className={styles.teaser}>
              <time
                className={styles.date}
                dateTime={post.firstPublishedAt.toISOString()}
              >
                {formatDate(post.firstPublishedAt)}
              </time>
              <h2>
                <Link to={`/posts/${post.id}`}>{post.title}</Link>
              </h2>
              <p className={styles.excerpt}>{excerpt(post.body)}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
