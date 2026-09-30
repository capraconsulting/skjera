import type { DocumentId } from "@skjera/documents/api";
import { Link, useNavigate, useParams } from "react-router";
import { Breadcrumbs } from "../../components/Breadcrumbs.tsx";
import { Field } from "../../components/Field.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { TextEditor } from "../../editor/TextEditor.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
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
  const { handle, team } = session;

  if (session.deleted) {
    return (
      <p role="alert" className={styles.message}>
        This post was deleted. <Link to="/studio/teams">Back to teams</Link>
      </p>
    );
  }

  if (handle === null) {
    return <p className={styles.message}>{session.error ?? "Loading…"}</p>;
  }

  const remove = async () => {
    if (!window.confirm("Delete this post? It is also taken off the site.")) {
      return;
    }
    await session.remove();
    navigate(team === null ? "/studio/teams" : `/studio/teams/${team.id}`);
  };

  return (
    <article className={styles.editor}>
      <Breadcrumbs
        items={[
          { to: "/studio/teams", label: "Teams" },
          ...(team === null
            ? []
            : [{ to: `/studio/teams/${team.id}`, label: team.name }]),
        ]}
      />
      {session.error === null ? null : (
        <p role="alert" className={styles.error}>
          {session.error}
        </p>
      )}
      {/* The editors start over when the session reloads with a new handle. */}
      <Field label="Title">
        <TextEditor handle={handle} path={titlePath} label="Title" large />
      </Field>
      <Field label="Body">
        <TextEditor handle={handle} path={bodyPath} label="Body" multiline />
      </Field>
      <EditorFooter
        id={id}
        handle={handle}
        saving={session.saving}
        publication={session.publication}
        publishing={session.publishing}
        onPublish={session.publish}
        onDelete={remove}
      />
    </article>
  );
}
