import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { DocumentId, EventContent } from "@skjera/documents/api";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Temporal } from "temporal-polyfill";
import { Button } from "../../components/Button.tsx";
import { attendees, events } from "../../sync/tables.ts";
import { timeAgo } from "../../time.ts";
import styles from "./EditorFooter.module.css";

/** The draft's version, as a string that changes whenever the draft does. */
const useVersion = (handle: DocHandle<EventContent>) =>
  useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => [...A.getHeads(handle.doc())].sort().join(","),
  );

/**
 * The editor's footer: save and publish state, and the actions. It follows
 * the draft itself, so the editors above don't re-render as it changes.
 */
export function EditorFooter(props: {
  readonly id: DocumentId;
  readonly handle: DocHandle<EventContent>;
  readonly saving: boolean;
  readonly publishing: boolean;
  readonly onPublish: () => void;
  readonly onDelete: () => void;
}) {
  const version = useVersion(props.handle);
  const { id } = props;
  // The published version, if any.
  const publication = useLiveQuery(
    (q) =>
      q
        .from({ event: events.collection })
        .where(({ event }) => eq(event.id, id))
        .findOne(),
    [id],
  ).data;
  const upToDate =
    publication !== undefined &&
    !props.saving &&
    [...publication.publishedHeads].sort().join(",") === version;
  const signedUp = useLiveQuery(
    (q) =>
      q
        .from({ attendee: attendees.collection })
        .where(({ attendee }) => eq(attendee.eventId, id)),
    [id],
  ).data.length;

  // Moving an event people signed up for emails them: say so first.
  const publish = () => {
    const draft = props.handle.doc();
    const moved =
      publication !== undefined &&
      (!sameInstant(draft.start, publication.startsAt) ||
        !sameInstant(draft.end, publication.endsAt));
    if (
      moved &&
      signedUp > 0 &&
      !window.confirm(
        `Publish the new time? ${
          signedUp === 1
            ? "The person signed up is"
            : `The ${signedUp} people signed up are`
        } emailed about it.`,
      )
    ) {
      return;
    }
    props.onPublish();
  };

  // Deleting an event people signed up for cancels it: say so first.
  const remove = () => {
    const cancels =
      publication !== undefined &&
      publication.endsAt.getTime() > Date.now() &&
      signedUp > 0;
    const question = cancels
      ? `Delete this event? It's taken off the site, and ${
          signedUp === 1
            ? "the person signed up is"
            : `the ${signedUp} people signed up are`
        } emailed that it's cancelled.`
      : "Delete this event? It is also taken off the site.";
    if (window.confirm(question)) props.onDelete();
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
          <span>{props.saving ? "Saving…" : "Saved"}</span>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          {publication === undefined ? (
            <span>Not published</span>
          ) : (
            <>
              <span title={publication.publishedAt.toLocaleString()}>
                Published {timeAgo(publication.publishedAt)}
              </span>
              <span className={styles.separator} aria-hidden="true">
                ·
              </span>
              <Link to={`/events/${props.id}`}>View on site</Link>
            </>
          )}
        </p>
        <div className={styles.actions}>
          <Button variant="danger" onClick={remove}>
            Delete
          </Button>
          <Button
            variant="primary"
            className={styles.publish}
            onClick={publish}
            disabled={props.publishing || upToDate}
          >
            {props.publishing
              ? "Publishing…"
              : upToDate
                ? "Published"
                : "Publish"}
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
