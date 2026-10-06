import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Field } from "../../components/Field.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { CheckboxField, useBooleanField } from "../../editor/CheckboxField.tsx";
import { CoverField } from "../../editor/CoverField.tsx";
import { EventTimes, FoodDeadline } from "../../editor/DateTimeField.tsx";
import { QuestionsField } from "../../editor/QuestionsField.tsx";
import { TagsField } from "../../editor/TagsField.tsx";
import { TextEditor } from "../../editor/TextEditor.tsx";
import {
  type DraftPresence,
  useDraftPresence,
} from "../../presence/presence.ts";
import { documents } from "../../sync/tables.ts";
import { Attendees } from "./Attendees.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import styles from "./EventEditor.module.css";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;
const foodPath = ["food"] as const;

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

  // Asked first, by the footer.
  const remove = () => {
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
        <Field label="Cover image">
          <CoverField handle={handle} presence={session.presence} />
        </Field>
        <EventTimes handle={handle} />
        <TagsField handle={handle} />
        <Field label="Visibility">
          <CheckboxField
            handle={handle}
            field="public"
            label="Public event"
            hint="Anyone can see it. Otherwise only signed-in users."
          />
          <GuestsCheckbox handle={handle} />
        </Field>
        <Field label="Emails">
          <CheckboxField
            handle={handle}
            field="reminders"
            label="Remind attendees"
            hint="Everyone signed up gets an email the day before."
          />
        </Field>
        <Field label="Food">
          <CheckboxField
            handle={handle}
            field="dietary"
            label="Food is served"
            hint="Everyone signing up, members and guests, says what they can't eat."
          />
          <FoodDetails handle={handle} presence={session.presence} />
        </Field>
        <Field label="Questions">
          <QuestionsField handle={handle} />
        </Field>
        <Field label="Body">
          <TextEditor
            handle={handle}
            path={bodyPath}
            label="Body"
            rich
            presence={session.presence}
          />
        </Field>
        <Attendees id={id} />
      </div>
    </Pane>
  );
}

/** What is served, and until when people can say what they can't eat. */
function FoodDetails(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  const served = useBooleanField(props.handle, "dietary");
  if (!served) return null;
  return (
    <div className={styles.food}>
      <TextEditor
        handle={props.handle}
        path={foodPath}
        label="What's served"
        presence={props.presence}
      />
      <FoodDeadline handle={props.handle} />
    </div>
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
