import type { DocumentId } from "@skjera/documents/api";
import { useEffect, useRef } from "react";
import {
  useNavigate,
  useParams,
  useRevalidator,
  useSubmit,
} from "react-router";
import { Field } from "../../components/Field.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import {
  type SessionState,
  useDocumentSession,
} from "../../documents/session.ts";
import { DateField } from "../../editor/DateField.tsx";
import { TextEditor } from "../../editor/TextEditor.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import styles from "./EventEditor.module.css";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

/** The third column: the selected event. */
export function EventEditor() {
  const { id } = useParams();
  return <EventSession key={id} id={id as DocumentId} />;
}

/**
 * Refreshes the events column once saving settles and after publishing, so
 * titles and badges there follow the editor.
 */
function useRefreshEventsList(session: SessionState) {
  const revalidator = useRevalidator();
  const revalidate = useRef(revalidator.revalidate);
  revalidate.current = revalidator.revalidate;
  const saved = session.handle !== null && !session.saving;

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => void revalidate.current(), 1000);
    return () => clearTimeout(timer);
  }, [saved]);

  useEffect(() => {
    if (session.publication !== null) void revalidate.current();
  }, [session.publication]);
}

function EventSession({ id }: { readonly id: DocumentId }) {
  const session = useDocumentSession(id);
  const { teamId } = useParams();
  const navigate = useNavigate();
  const submit = useSubmit();
  const { handle, team } = session;
  useRefreshEventsList(session);

  // A link with the wrong team: go to where the event actually is.
  useEffect(() => {
    if (team !== null && team.id !== teamId) {
      navigate(`/studio/teams/${team.id}/events/${id}`, { replace: true });
    }
  }, [team, teamId, id, navigate]);

  if (session.deleted) {
    return (
      <PanePlaceholder>
        <p role="alert">This event was deleted.</p>
      </PanePlaceholder>
    );
  }

  if (handle === null) {
    return <PanePlaceholder>{session.error ?? "Loading…"}</PanePlaceholder>;
  }

  const remove = () => {
    if (!window.confirm("Delete this event? It is also taken off the site.")) {
      return;
    }
    // Through the team's route, so the events column updates too.
    submit(
      { intent: "delete-event", id },
      { method: "post", action: `/studio/teams/${teamId}` },
    );
  };

  return (
    <Pane
      title="Event"
      label="Editor"
      footer={
        <EditorFooter
          id={id}
          handle={handle}
          saving={session.saving}
          publication={session.publication}
          publishing={session.publishing}
          onPublish={session.publish}
          onDelete={remove}
        />
      }
    >
      <div className={styles.content}>
        {session.error === null ? null : (
          <p role="alert" className={styles.error}>
            {session.error}
          </p>
        )}
        {/* The editors start over when the session reloads with a new handle. */}
        <Field label="Title">
          <TextEditor handle={handle} path={titlePath} label="Title" large />
        </Field>
        <Field label="Date">
          <DateField handle={handle} label="Date" />
        </Field>
        <Field label="Body">
          <TextEditor handle={handle} path={bodyPath} label="Body" multiline />
        </Field>
      </div>
    </Pane>
  );
}
