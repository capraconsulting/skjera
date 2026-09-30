import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Field } from "../../components/Field.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { CheckboxField, useBooleanField } from "../../editor/CheckboxField.tsx";
import { DateField } from "../../editor/DateField.tsx";
import { TextEditor } from "../../editor/TextEditor.tsx";
import { useDraftPresence } from "../../presence/presence.ts";
import { documents } from "../../sync/tables.ts";
import { Attendees } from "./Attendees.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import styles from "./EventEditor.module.css";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;

/** The third column: the selected event. */
export function EventEditor() {
  const { id } = useParams();
  return <EventSession key={id} id={id as DocumentId} />;
}

function EventSession({ id }: { readonly id: DocumentId }) {
  const session = useDocumentSession(id);
  const { teamId } = useParams();
  const navigate = useNavigate();
  const { handle } = session;
  const owner = session.teamId;
  const here = useDraftPresence(session.presence);

  // A link with the wrong team: go to where the event actually is.
  useEffect(() => {
    if (owner !== null && owner !== teamId) {
      navigate(`/studio/teams/${owner}/events/${id}`, { replace: true });
    }
  }, [owner, teamId, id, navigate]);

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
    documents.collection.delete(id);
    navigate(`/studio/teams/${teamId}`);
  };

  return (
    <Pane
      title="Event"
      label="Editor"
      actions={<Avatars entries={here} />}
      footer={
        <EditorFooter
          id={id}
          handle={handle}
          saving={session.saving}
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
        <Field label="Title">
          <TextEditor
            handle={handle}
            path={titlePath}
            label="Title"
            large
            presence={session.presence}
          />
        </Field>
        <Field label="Date">
          <DateField handle={handle} label="Date" />
        </Field>
        <Field label="Visibility">
          <CheckboxField
            handle={handle}
            field="public"
            label="Public event"
            hint="Anyone can see it. Otherwise only signed-in users."
          />
          <GuestsCheckbox handle={handle} />
          <CheckboxField
            handle={handle}
            field="dietary"
            label="Ask for dietary preferences"
            hint="Everyone signing up, members and guests, has to fill it in."
          />
        </Field>
        <Field label="Body">
          <TextEditor
            handle={handle}
            path={bodyPath}
            label="Body"
            multiline
            presence={session.presence}
          />
        </Field>
        <Attendees id={id} />
      </div>
    </Pane>
  );
}

/** Guests can only sign up for public events. */
function GuestsCheckbox(props: { readonly handle: DocHandle<EventContent> }) {
  const isPublic = useBooleanField(props.handle, "public");
  return (
    <CheckboxField
      handle={props.handle}
      field="guests"
      label="Guests can sign up"
      hint={
        isPublic
          ? "People without an account can attend with their name and email."
          : "Only public events can take guest signups."
      }
      disabled={!isPublic}
    />
  );
}
