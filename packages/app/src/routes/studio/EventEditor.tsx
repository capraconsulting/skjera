import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useEffect, useSyncExternalStore } from "react";
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
const placePath = ["place"] as const;

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
        <p role="alert">{m.studio_event_deleted()}</p>
      </PanePlaceholder>
    );
  }

  if (handle === null) {
    return (
      <PanePlaceholder>{session.error ?? m.common_loading()}</PanePlaceholder>
    );
  }

  // Asked first, by the footer.
  const remove = () => {
    documents.collection.delete(id);
    navigate(`/studio/teams/${teamId}`);
  };

  return (
    <Pane
      title={m.studio_event()}
      label={m.studio_editor()}
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
        <Field label={m.studio_title()}>
          <TextEditor
            handle={handle}
            path={titlePath}
            label={m.studio_title()}
            large
            presence={session.presence}
          />
        </Field>
        <Field label={m.studio_cover_image()}>
          <CoverField handle={handle} presence={session.presence} />
        </Field>
        <EventTimes handle={handle} />
        <Field label={m.site_place()}>
          <Place handle={handle} presence={session.presence} />
        </Field>
        <TagsField handle={handle} />
        <Field label={m.studio_visibility()}>
          <CheckboxField
            handle={handle}
            field="public"
            label={m.studio_public_event()}
            hint={m.studio_public_hint()}
          />
          <GuestsCheckbox handle={handle} />
        </Field>
        <Field label={m.studio_emails()}>
          <CheckboxField
            handle={handle}
            field="reminders"
            label={m.studio_remind()}
            hint={m.studio_remind_hint()}
          />
        </Field>
        <Field label={m.site_food()}>
          <CheckboxField
            handle={handle}
            field="dietary"
            label={m.studio_food_served()}
            hint={m.studio_food_hint()}
          />
          <FoodDetails handle={handle} presence={session.presence} />
        </Field>
        <Field label={m.studio_questions()}>
          <QuestionsField handle={handle} />
        </Field>
        <Field label={m.studio_body()}>
          <TextEditor
            handle={handle}
            path={bodyPath}
            label={m.studio_body()}
            rich
            presence={session.presence}
          />
        </Field>
        <Attendees id={id} />
      </div>
    </Pane>
  );
}

/** Where it is. A draft from before events had a place gets one to write in. */
function Place(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  const { handle } = props;
  useEffect(() => {
    if (handle.doc().place === undefined) {
      handle.change((doc) => {
        (doc as { place?: string }).place = "";
      });
    }
  }, [handle]);
  // The text's object, so a new editor starts if someone else's wins. A
  // text's value is a plain string: its id is asked of the draft by key.
  const text = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const doc = handle.doc();
      return doc.place === undefined ? null : A.getObjectId(doc, "place");
    },
  );
  if (text === null) return null;
  return (
    <TextEditor
      key={text}
      handle={handle}
      path={placePath}
      label={m.site_place()}
      presence={props.presence}
    />
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
        label={m.studio_whats_served()}
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
      label={m.studio_guests()}
      hint={isPublic ? m.studio_guests_hint() : m.studio_guests_public_only()}
      disabled={!isPublic}
    />
  );
}
