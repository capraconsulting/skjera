import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "react-router";
import { Temporal } from "temporal-polyfill";
import buttonStyles from "../../components/Button.module.css";
import { Button } from "../../components/Button.tsx";
import { useVersion } from "../../documents/version.ts";
import { attendees, events } from "../../sync/tables.ts";
import { timeAgo } from "../../time.ts";
import styles from "./EditorFooter.module.css";
import { publishState } from "./publishState.ts";

/**
 * The editor's footer: save and publish state, and the actions. It follows
 * the draft itself, so the editors above don't re-render as it changes.
 */
export function EditorFooter(props: {
  readonly id: DocumentId;
  readonly handle: DocHandle<EventContent>;
  readonly saving: boolean;
  readonly publishing: boolean;
  readonly unpublishing: boolean;
  readonly discarding: boolean;
  readonly copying: boolean;
  readonly onPublish: () => void;
  readonly onUnpublish: () => void;
  readonly onDiscard: () => void;
  readonly onCopy: () => void;
  readonly onDelete: () => void;
}) {
  const version = useVersion(props.handle);
  const { id } = props;
  // The published version, if any.
  const publication = useLiveQuery({
    query: (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
  }).data;
  const { upToDate, changed } = publishState({
    publishedHeads: publication?.publishedHeads,
    version,
    saving: props.saving,
  });
  const signedUp = useLiveQuery({
    query: (q) =>
      q
        .from({ attendee: attendees.collection })
        .where(({ attendee }) => eq(attendee.eventId, id)),
  }).data.length;

  // Moving an event people signed up for, or giving it another place,
  // emails them: say so first.
  const publish = () => {
    const draft = props.handle.doc();
    const moved =
      publication !== undefined &&
      (!sameInstant(draft.start, publication.startsAt) ||
        !sameInstant(draft.end, publication.endsAt));
    const place = draft.place ?? "";
    // As published: compared as written, as the server compares it.
    const newPlace =
      publication !== undefined &&
      place.trim() !== "" &&
      place !== (publication.place ?? "");
    const question =
      moved && newPlace
        ? m.studio_confirm_move_and_place
        : moved
          ? m.studio_confirm_move
          : newPlace
            ? m.studio_confirm_new_place
            : null;
    if (
      question !== null &&
      signedUp > 0 &&
      !window.confirm(question({ count: signedUp }))
    ) {
      return;
    }
    props.onPublish();
  };

  // Taking an event off the site, or deleting it, before it ends cancels it
  // for the people signed up.
  const cancels = () =>
    publication !== undefined &&
    publication.endsAt.getTime() > Date.now() &&
    signedUp > 0;

  const remove = () => {
    const question = cancels()
      ? m.studio_confirm_delete_cancels({ count: signedUp })
      : m.studio_confirm_delete();
    if (window.confirm(question)) props.onDelete();
  };

  const unpublish = () => {
    const question = cancels()
      ? m.studio_confirm_unpublish_cancels({ count: signedUp })
      : m.studio_confirm_unpublish();
    if (window.confirm(question)) props.onUnpublish();
  };

  const discard = () => {
    if (window.confirm(m.studio_confirm_discard())) props.onDiscard();
  };

  return (
    <footer className={styles.footer}>
      <div className={styles.bar}>
        <p className={styles.status} data-testid="status">
          <span
            className={
              props.saving ? `${styles.dot} ${styles.saving}` : styles.dot
            }
            aria-hidden="true"
          />
          <span>{props.saving ? m.studio_saving() : m.studio_saved()}</span>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          {publication === undefined ? (
            <span>{m.studio_not_published()}</span>
          ) : (
            <>
              <span title={publication.publishedAt.toLocaleString(getLocale())}>
                {m.studio_published_ago({
                  ago: timeAgo(publication.publishedAt),
                })}
              </span>
              <span className={styles.separator} aria-hidden="true">
                ·
              </span>
              <Link to={`/events/${props.id}`}>{m.studio_view_on_site()}</Link>
            </>
          )}
        </p>
        <div className={styles.actions}>
          <a
            className={`${buttonStyles.button} ${styles.preview}`}
            href={`/events/${props.id}/preview`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.studio_preview()}
          </a>
          <Button variant="danger" onClick={remove}>
            {m.common_delete()}
          </Button>
          <Button onClick={props.onCopy} disabled={props.copying}>
            {m.studio_copy()}
          </Button>
          {changed && (
            <Button
              onClick={discard}
              disabled={
                props.publishing || props.unpublishing || props.discarding
              }
            >
              {m.studio_discard_changes()}
            </Button>
          )}
          {publication !== undefined && (
            <Button
              onClick={unpublish}
              disabled={
                props.publishing || props.unpublishing || props.discarding
              }
            >
              {m.studio_unpublish()}
            </Button>
          )}
          <Button
            variant="primary"
            className={styles.publish}
            onClick={publish}
            disabled={props.publishing || props.discarding || upToDate}
          >
            {props.publishing
              ? m.studio_publishing()
              : upToDate
                ? m.studio_published()
                : m.studio_publish()}
          </Button>
        </div>
      </div>
    </footer>
  );
}

/** Whether a draft's time is when it was published (`at`). */
const sameInstant = (time: unknown, at: Date) =>
  time === null ||
  time === undefined ||
  Temporal.ZonedDateTime.from(String(time)).epochMilliseconds === at.getTime();
