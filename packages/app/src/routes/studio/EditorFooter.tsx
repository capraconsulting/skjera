import type { DocHandle } from "@automerge/automerge-repo/slim";
import type {
  CancellingNotice,
  DocumentId,
  EventContent,
  PublishingNotice,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { appPaths } from "@skjera/paths";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/Button.tsx";
import { useVersion } from "../../documents/version.ts";
import { events } from "../../sync/tables.ts";
import { timeAgo } from "../../time.ts";
import { publishQuestion, unpublishQuestion } from "./attendeeNotices.ts";
import styles from "./EditorFooter.module.css";
import { History } from "./History.tsx";
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
  readonly restoring: boolean;
  readonly copying: boolean;
  readonly onPublish: (confirm: (notice: PublishingNotice) => boolean) => void;
  readonly onUnpublish: (
    confirm: (notice: CancellingNotice) => boolean,
  ) => void;
  readonly onDiscard: () => void;
  readonly onRestore: (heads: ReadonlyArray<string>) => void;
  readonly onCopy: () => void;
  readonly onDelete: () => void;
}) {
  const version = useVersion(props.handle);
  const { id } = props;
  const [historyOpen, setHistoryOpen] = useState(false);
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
  const publish = () =>
    props.onPublish((notice) => {
      const question = publishQuestion(notice);
      return question === null || window.confirm(question);
    });

  const unpublish = () =>
    props.onUnpublish((notice) => window.confirm(unpublishQuestion(notice)));

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
              <Link to={appPaths.event(props.id)}>
                {m.studio_view_on_site()}
              </Link>
            </>
          )}
        </p>
        <div className={styles.actions}>
          <Button
            as="a"
            className={styles.preview}
            href={appPaths.preview(props.id)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.studio_preview()}
          </Button>
          <Button variant="danger" onClick={props.onDelete}>
            {m.common_delete()}
          </Button>
          <Button onClick={() => setHistoryOpen(true)}>
            {m.studio_history()}
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
      <History
        id={id}
        open={historyOpen}
        version={version}
        restoring={props.restoring}
        onRestore={props.onRestore}
        onClose={() => setHistoryOpen(false)}
      />
    </footer>
  );
}
