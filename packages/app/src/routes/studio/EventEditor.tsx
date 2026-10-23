import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Field } from "../../components/Field.tsx";
import { Input } from "../../components/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { CheckboxField, useBooleanField } from "../../editor/CheckboxField.tsx";
import { CoverField } from "../../editor/CoverField.tsx";
import { EventTimes, FoodDeadline } from "../../editor/DateTimeField.tsx";
import { QuestionsField } from "../../editor/QuestionsField.tsx";
import { RepeatField } from "../../editor/RepeatField.tsx";
import { TagsField } from "../../editor/TagsField.tsx";
import { TextEditor } from "../../editor/text/TextEditor.tsx";
import {
  type DraftPresence,
  useDraftPresence,
} from "../../presence/presence.ts";
import { documents } from "../../sync/tables.ts";
import { Attendees } from "./Attendees.tsx";
import { DraftText } from "./DraftText.tsx";
import { EditorFooter } from "./EditorFooter.tsx";
import { EmailTexts } from "./EmailTexts.tsx";
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
          unpublishing={session.unpublishing}
          onPublish={session.publish}
          onUnpublish={session.unpublish}
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
        <Field label={m.studio_summary()}>
          <DraftText
            handle={handle}
            presence={session.presence}
            field="summary"
            label={m.studio_summary()}
          />
        </Field>
        <Field label={m.studio_cover_image()}>
          <CoverField handle={handle} presence={session.presence} />
        </Field>
        <EventTimes handle={handle} />
        <Field label={m.studio_recurrence()}>
          <CheckboxField
            handle={handle}
            field="recurring"
            label={m.studio_recurring()}
            hint={m.studio_recurring_hint()}
          />
          <RepeatField handle={handle} />
        </Field>
        <Field label={m.site_place()}>
          <DraftText
            handle={handle}
            presence={session.presence}
            field="place"
            label={m.site_place()}
          />
        </Field>
        <Field label={m.studio_streaming()}>
          <CheckboxField
            handle={handle}
            field="streamed"
            label={m.studio_streamed()}
            hint={m.studio_streamed_hint()}
          />
          <StreamLink handle={handle} presence={session.presence} />
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
        <Field label={m.studio_max_attendees()}>
          <AttendeeLimit handle={handle} />
        </Field>
        <Field label={m.studio_emails()}>
          <CheckboxField
            handle={handle}
            field="reminders"
            label={m.studio_remind()}
            hint={m.studio_remind_hint()}
          />
          <EmailTexts handle={handle} presence={session.presence} />
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

/** Where to follow the stream, while the event is streamed. */
function StreamLink(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  const streamed = useBooleanField(props.handle, "streamed");
  if (!streamed) return null;
  return (
    <div className={styles.food}>
      <DraftText
        handle={props.handle}
        presence={props.presence}
        field="streamLink"
        label={m.studio_stream_link()}
      />
    </div>
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

/** A limit: a whole number of at least one that fits a Postgres integer. */
const isLimit = (number: number) =>
  Number.isInteger(number) && number >= 1 && number <= 2_147_483_647;

/** The most who can sign up, and whether the site says how many places are left. */
function AttendeeLimit(props: { readonly handle: DocHandle<EventContent> }) {
  const { handle } = props;
  const limit = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => handle.doc().maxAttendees ?? null,
  );
  // While what is typed isn't a limit ("-", "0", "1.5"), it stays in the
  // field and isn't saved; leaving the field shows the saved one again.
  const [typed, setTyped] = useState<string | null>(null);
  const write = (input: HTMLInputElement) => {
    const number = Number(input.value);
    if (input.validity.badInput || (input.value !== "" && !isLimit(number))) {
      setTyped(input.value);
      return;
    }
    setTyped(null);
    handle.change((doc) => {
      const draft = doc as { maxAttendees?: number };
      if (input.value === "") delete draft.maxAttendees;
      else draft.maxAttendees = number;
    });
  };
  return (
    <>
      <Input
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        aria-label={m.studio_max_attendees()}
        placeholder={m.studio_no_limit()}
        value={typed ?? (limit === null ? "" : String(limit))}
        onChange={(event) => write(event.target)}
        onBlur={() => setTyped(null)}
      />
      {limit === null ? null : (
        <CheckboxField
          handle={handle}
          field="hidePlacesLeft"
          label={m.studio_hide_places_left()}
        />
      )}
    </>
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
