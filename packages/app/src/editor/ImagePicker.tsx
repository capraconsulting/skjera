import type { ImagePage } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/controls/Button.tsx";
import { Dialog, dialogStyles } from "../components/controls/Dialog.tsx";
import { formatDateTime, localTimeZone } from "../time.ts";
import styles from "./ImagePicker.module.css";
import { listImages } from "./uploadImage.ts";

/**
 * The images already uploaded to Skjera, newest first, as small pictures
 * that load more as the list is scrolled. Picking one hands over where it is
 * served and closes the list. Render it beside another dialog, not inside it:
 * a dialog's `close` event reaches the `onClose` of every dialog around it.
 */
export function ImagePicker(props: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onPick: (url: string) => void;
}) {
  return (
    <Dialog
      open={props.open}
      title={m.editor_existing_title()}
      onClose={props.onClose}
    >
      <Pictures
        onClose={props.onClose}
        onPick={(url) => {
          props.onPick(url);
          props.onClose();
        }}
      />
    </Dialog>
  );
}

/** Mounted while the dialog is open: each opening starts from the first page. */
function Pictures(props: {
  readonly onClose: () => void;
  readonly onPick: (url: string) => void;
}) {
  const [images, setImages] = useState<ImagePage["images"]>([]);
  // The cursor of the page to load next; undefined until the first has come.
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loading = useRef(false);
  const end = useRef<HTMLDivElement>(null);

  // One page at a time.
  const load = useCallback(async (after: string | undefined) => {
    if (loading.current) return;
    loading.current = true;
    setBusy(true);
    setError(null);
    try {
      const page = await listImages(after);
      setImages((shown) => [...shown, ...page.images]);
      setNext(page.next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loading.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load(undefined);
  }, [load]);

  // The next page, when the end of what is shown comes into view.
  useEffect(() => {
    const element = end.current;
    if (element === null || !next || error !== null || busy) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void load(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [next, error, busy, load]);

  return (
    <>
      {next === null && images.length === 0 ? (
        <p className={styles.note}>{m.editor_existing_empty()}</p>
      ) : (
        <div className={styles.scroller}>
          <div className={styles.grid}>
            {images.map((image) => (
              <button
                key={image.url}
                type="button"
                className={styles.picture}
                aria-label={m.editor_existing_image({
                  date: formatDateTime(
                    new Date(image.uploadedAt),
                    localTimeZone(),
                  ),
                })}
                onClick={() => props.onPick(image.url)}
              >
                <img
                  className={styles.thumbnail}
                  src={image.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ))}
          </div>
          <div ref={end} className={styles.end} />
        </div>
      )}
      {busy ? <p className={styles.note}>{m.common_loading()}</p> : null}
      {error === null ? null : (
        <>
          <p role="alert" className={dialogStyles.error}>
            {error}
          </p>
          <Button onClick={() => void load(next ?? undefined)}>
            {m.editor_existing_retry()}
          </Button>
        </>
      )}
      <div className={dialogStyles.actions}>
        <Button onClick={props.onClose}>{m.common_cancel()}</Button>
      </div>
    </>
  );
}
