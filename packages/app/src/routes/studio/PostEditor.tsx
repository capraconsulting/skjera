import type { DocumentId } from "@skjera/documents/api";
import { Link, useNavigate, useParams } from "react-router";
import { Field } from "../../components/Field.tsx";
import { Toolbar } from "../../components/Toolbar.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { TextEditor } from "../../editor/TextEditor.tsx";
import styles from "./PostEditor.module.css";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

export function PostEditor() {
  const { id } = useParams();
  return <PostSession key={id} id={id as DocumentId} />;
}

function PostSession({ id }: { readonly id: DocumentId }) {
  const session = useDocumentSession(id);
  const navigate = useNavigate();
  const { handle, publication } = session;

  if (session.deleted) {
    return (
      <p role="alert">
        This post was deleted. <Link to="/studio/teams">Back to teams</Link>
      </p>
    );
  }

  const remove = async () => {
    if (!window.confirm("Delete this post? It is also taken off the site.")) {
      return;
    }
    await session.remove();
    navigate(
      session.team === null
        ? "/studio/teams"
        : `/studio/teams/${session.team.id}`,
    );
  };

  if (handle === null) {
    return <p>{session.error ?? "Loading…"}</p>;
  }

  return (
    <article>
      {session.team === null ? null : (
        <p>
          <Link to="/studio/teams">Teams</Link> ›{" "}
          <Link to={`/studio/teams/${session.team.id}`}>
            {session.team.name}
          </Link>
        </p>
      )}
      <Toolbar>
        <p data-testid="status">
          {session.saving ? "Saving…" : "Saved"}
          {" · "}
          {publication === null
            ? "Not published"
            : `Published ${publication.publishedAt.toLocaleString()}`}
          {publication === null ? null : (
            <>
              {" · "}
              <Link to={`/posts/${id}`}>View on site</Link>
            </>
          )}
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={remove}>
            Delete
          </button>
          <button
            type="button"
            onClick={session.publish}
            disabled={session.publishing}
          >
            {session.publishing ? "Publishing…" : "Publish"}
          </button>
        </div>
      </Toolbar>
      {session.error === null ? null : (
        <p role="alert" className={styles.error}>
          {session.error}
        </p>
      )}
      {/* The editors start over when the session reloads with a new handle. */}
      <Field label="Title">
        <TextEditor handle={handle} path={titlePath} label="Title" />
      </Field>
      <Field label="Body">
        <TextEditor handle={handle} path={bodyPath} label="Body" multiline />
      </Field>
    </article>
  );
}
