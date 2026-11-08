import type { DocumentId, HistoryEntry } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import { appPaths } from "@skjera/paths";
import { useEffect, useState } from "react";
import { Button } from "../../../components/controls/Button.tsx";
import { Dialog, dialogStyles } from "../../../components/controls/Dialog.tsx";
import { eventHistory } from "../../../sync/tables.ts";
import { timeAgo } from "../../../time.ts";
import styles from "./History.module.css";
import { isDraft } from "./publishState.ts";

const kinds = {
  edited: () => m.studio_history_edited(),
  published: () => m.studio_history_published(),
  restored: () => m.studio_history_restored(),
  discarded: () => m.studio_history_discarded(),
} as const;

const whoMade = (entry: HistoryEntry) =>
  entry.automatic
    ? m.studio_history_skjera()
    : (entry.by ?? m.studio_history_unknown());

/**
 * The event's versions, newest first: what happened, by whom and when, a
 * link to see the event as it was then, and a button to make the draft that
 * version. Read again whenever the draft changes while it is open.
 */
export function History(props: {
  readonly id: DocumentId;
  readonly open: boolean;
  /** The draft's version, from `useVersion`. */
  readonly version: string;
  readonly restoring: boolean;
  readonly onRestore: (heads: ReadonlyArray<string>) => void;
  readonly onClose: () => void;
}) {
  const { id, open, version, onClose } = props;
  const [entries, setEntries] = useState<ReadonlyArray<HistoryEntry> | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  // `version` is read again when the draft changes: it is not used inside.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed draft is a reason to read again
  useEffect(() => {
    if (!open) return;
    let current = true;
    eventHistory(id).then(
      (found) => {
        if (!current) return;
        setEntries(found);
        setError(null);
      },
      () => {
        if (current) setError(m.studio_history_failed());
      },
    );
    return () => {
      current = false;
    };
  }, [open, id, version]);

  useEffect(() => {
    if (!open) setEntries(null);
  }, [open]);

  const restore = (heads: ReadonlyArray<string>) => {
    if (!window.confirm(m.studio_confirm_restore())) return;
    props.onRestore(heads);
    onClose();
  };

  return (
    <Dialog open={open} title={m.studio_history()} onClose={onClose}>
      {error === null ? null : (
        <p role="alert" className={dialogStyles.error}>
          {error}
        </p>
      )}
      {entries === null ? (
        error === null && (
          <p className={styles.status}>{m.studio_history_loading()}</p>
        )
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => {
            const key = `${entry.kind}:${entry.at.getTime()}:${entry.heads.join(",")}`;
            return (
              <li key={key} className={styles.entry}>
                <span className={styles.kind}>{kinds[entry.kind]()}</span>
                <span
                  className={styles.meta}
                  title={entry.at.toLocaleString(getLocale())}
                >
                  {m.studio_history_by({ name: whoMade(entry) })} ·{" "}
                  {timeAgo(entry.at)}
                </span>
                <div className={styles.actions}>
                  <Button
                    as="a"
                    className={styles.view}
                    href={appPaths.preview(id, entry.heads.join(","))}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.studio_history_view()}
                  </Button>
                  {!isDraft(entry.heads, version) && (
                    <Button
                      onClick={() => restore(entry.heads)}
                      disabled={props.restoring}
                    >
                      {m.studio_restore_version()}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className={dialogStyles.actions}>
        <Button onClick={onClose}>{m.common_close()}</Button>
      </div>
    </Dialog>
  );
}
