import * as A from "@automerge/automerge/slim";
import type {
  DocumentId,
  EventContent,
  Publication,
} from "@skjera/documents/api";
import { useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button.tsx";
import type { LocalDocHandle } from "../../editor/LocalDocHandle.ts";
import { timeAgo } from "../../time.ts";
import styles from "./EditorFooter.module.css";

/** The draft's version, as a string that changes whenever the draft does. */
const useVersion = (handle: LocalDocHandle<EventContent>) =>
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
  readonly handle: LocalDocHandle<EventContent>;
  readonly saving: boolean;
  readonly publication: Publication | null;
  readonly publishing: boolean;
  readonly onPublish: () => void;
  readonly onDelete: () => void;
}) {
  const version = useVersion(props.handle);
  const { publication } = props;
  const upToDate =
    publication !== null &&
    !props.saving &&
    [...publication.heads].sort().join(",") === version;

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
          {publication === null ? (
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
          <Button variant="danger" onClick={props.onDelete}>
            Delete
          </Button>
          <Button
            variant="primary"
            className={styles.publish}
            onClick={props.onPublish}
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
