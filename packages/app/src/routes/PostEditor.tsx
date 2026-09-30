import type { DocumentId } from "@skjera/documents/api";
import { useParams } from "react-router";
import { useDocumentSession } from "../documents/session.ts";
import { TextEditor } from "../editor/TextEditor.tsx";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

export function PostEditor() {
  const { id } = useParams();
  return <PostSession key={id} id={id as DocumentId} />;
}

function PostSession({ id }: { readonly id: DocumentId }) {
  const session = useDocumentSession(id);
  const { handle, publication } = session;

  if (handle === null) {
    return <p>{session.error ?? "Loading…"}</p>;
  }

  return (
    <article className="post-editor">
      <div className="toolbar">
        <p data-testid="status">
          {session.saving ? "Saving…" : "Saved"}
          {" · "}
          {publication === null
            ? "Not published"
            : `Published ${publication.publishedAt.toLocaleString()}`}
        </p>
        <button
          type="button"
          onClick={session.publish}
          disabled={session.publishing}
        >
          {session.publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
      {session.error === null ? null : (
        <p role="alert" className="error">
          {session.error}
        </p>
      )}
      {/* The editors start over when the session reloads with a new handle. */}
      <div className="field">
        Title
        <TextEditor handle={handle} path={titlePath} label="Title" />
      </div>
      <div className="field">
        Body
        <TextEditor handle={handle} path={bodyPath} label="Body" multiline />
      </div>
    </article>
  );
}
