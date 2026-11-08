import type { DocHandle } from "@automerge/automerge-repo/slim";
import {
  type CancellingNotice,
  type DocumentId,
  defaultEventType,
  type EventContent,
  isAttendeeLimit,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { Effect } from "effect";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatars } from "../../components/Avatars.tsx";
import { Field } from "../../components/controls/Field.tsx";
import { Input } from "../../components/controls/Input.tsx";
import { Pane, PanePlaceholder } from "../../components/Pane.tsx";
import { useDocumentSession } from "../../documents/session.ts";
import { CheckboxField, useBooleanField } from "../../editor/CheckboxField.tsx";
import { CoverField } from "../../editor/cover/CoverField.tsx";
import { EventTimes, FoodDeadline } from "../../editor/DateTimeField.tsx";
import { QuestionsField } from "../../editor/QuestionsField.tsx";
import { ReminderField } from "../../editor/ReminderField.tsx";
import { RepeatField } from "../../editor/RepeatField.tsx";
import { salesEventOffered } from "../../editor/salesEvent.ts";
import { TagsField } from "../../editor/TagsField.tsx";
import { TextEditor } from "../../editor/text/TextEditor.tsx";
import { currentSite } from "../../i18n.ts";
import {
  type DraftPresence,
  useDraftPresence,
} from "../../presence/presence.ts";
import {
  cancellingNotice,
  deleteDocument,
  documents,
} from "../../sync/tables.ts";
import { Attendees } from "./attendance/Attendees.tsx";
import { confirmNotice, deleteQuestion } from "./attendance/attendeeNotices.ts";
import { Invitations } from "./attendance/Invitations.tsx";
import { DraftText } from "./DraftText.tsx";
import styles from "./EventEditor.module.css";
import { EmailTexts } from "./email-texts/EmailTexts.tsx";
import { OrganizerField } from "./OrganizerField.tsx";
import { EditorFooter } from "./publishing/EditorFooter.tsx";

const titlePath = ["title"] as const;
const bodyPath = ["body"] as const;
const foodPath = ["food"] as const;

export const salesEventTypeLabel = () =>
  m.studio_sales_event_type({ eventType: defaultEventType });

/** The third column: the selected event. */
export function EventEditor() {
  const { id } = useParams();
  return <EventSession key={id} id={id as DocumentId} />;
}

function EventSession({ id }: { readonly id: DocumentId }) {
  const session = useDocumentSession(id);
  const teamId = useParams().teamId as string;
  const navigate = useNavigate();
  const { handle } = session;
  const owner = session.teamId;
  const here = useDraftPresence(session.presence);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // A link with the wrong team: go to where the event actually is.
  useEffect(() => {
    if (owner !== null && owner !== teamId) {
      navigate(appPaths.studioEvent(owner, id), { replace: true });
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

  const remove = async () => {
    setDeleteError(null);
    try {
      const deleted = await confirmNotice(
        await Effect.runPromise(cancellingNotice(id)),
        deleteQuestion,
        (question) => window.confirm(question),
        async (confirmed) => {
          const result = await deleteDocument(id, confirmed);
          return result === undefined
            ? undefined
            : {
                _tag: "NoticeChanged" as const,
                notice: result.notice as CancellingNotice,
              };
        },
      );
      if (!deleted) return;
      navigate(appPaths.studioTeam(teamId));
      void documents.refresh();
    } catch {
      setDeleteError(m.studio_delete_failed());
    }
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
          discarding={session.discarding}
          restoring={session.restoring}
          copying={session.copying}
          onPublish={session.publish}
          onUnpublish={session.unpublish}
          onDiscard={session.discard}
          onRestore={session.restore}
          onCopy={() =>
            session.copy((copy) =>
              navigate(appPaths.studioEvent(owner ?? teamId, copy)),
            )
          }
          onDelete={() => void remove()}
        />
      }
    >
      <div className={styles.content}>
        {session.error === null && deleteError === null ? null : (
          <p role="alert" className={styles.error}>
            {session.error ?? deleteError}
          </p>
        )}
        {owner === null ? null : (
          <OrganizerField
            teamId={owner}
            locked={session.firstPublishedAt !== null}
            moving={session.moving}
            onChoose={session.move}
          />
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
          <SalesEventSetting handle={handle} presence={session.presence} />
        </Field>
        <Field label={m.studio_max_attendees()}>
          <AttendeeLimit handle={handle} />
        </Field>
        <Field label={m.studio_emails()}>
          <ReminderField handle={handle} />
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
            imageChoices
            presence={session.presence}
          />
        </Field>
        <Attendees id={id} />
        <Invitations id={id} />
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
    if (
      input.validity.badInput ||
      (input.value !== "" && !isAttendeeLimit(number))
    ) {
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

/**
 * Sending the event to HubSpot, and the type it is sent as: offered only
 * where `salesEventOffered` says so.
 */
function SalesEventSetting(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  const isPublic = useBooleanField(props.handle, "public");
  const guests = useBooleanField(props.handle, "guests");
  const salesEvent = useBooleanField(props.handle, "salesEvent");
  if (!salesEventOffered(currentSite(), { public: isPublic, guests })) {
    return null;
  }
  return (
    <>
      <CheckboxField
        handle={props.handle}
        field="salesEvent"
        label={m.studio_sales_event()}
        hint={m.studio_sales_event_hint()}
      />
      {salesEvent ? (
        <div className={styles.food}>
          <DraftText
            handle={props.handle}
            presence={props.presence}
            field="salesEventType"
            label={salesEventTypeLabel()}
          />
        </div>
      ) : null}
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
