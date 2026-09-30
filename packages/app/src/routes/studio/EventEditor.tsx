import type { DocumentId, EventContent } from "@skjera/documents/api";
import { useEffect, useRef } from "react";
import {
  useNavigate,
  useParams,
  useRevalidator,
  useSubmit,
} from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Field } from "../../components/Field.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import {
  type SessionState,
  useDocumentSession,
} from "../../documents/session.ts";
import { CheckboxField, useBooleanField } from "../../editor/CheckboxField.tsx";
import { DateField } from "../../editor/DateField.tsx";
import type { LocalDocHandle } from "../../editor/LocalDocHandle.ts";
import { TextEditor } from "../../editor/TextEditor.tsx";
import { usePresence } from "../../presence/presence.ts";
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
  const here = usePresence().filter(
    (entry) => entry.location?.documentId === id,
  );

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
      actions={<Avatars entries={here} />}
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
          <TextEditor
            handle={handle}
            path={titlePath}
            label="Title"
            large
            presence={{ documentId: id }}
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
            presence={{ documentId: id }}
          />
        </Field>
        <Attendees id={id} />
      </div>
    </Pane>
  );
}

/** Guests can only sign up for public events. */
function GuestsCheckbox(props: {
  readonly handle: LocalDocHandle<EventContent>;
}) {
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
