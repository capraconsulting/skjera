import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import {
  type ClipboardEvent,
  type DragEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../components/Button.tsx";
import type { DraftPresence } from "../presence/presence.ts";
import styles from "./CoverField.module.css";
import { TextEditor } from "./text/TextEditor.tsx";
import { acceptedImages, imageFiles, uploadImage } from "./uploadImage.ts";

const altPath = ["cover", "alt"] as const;

type Draft = { cover?: { src: unknown; alt: string } };

/**
 * An event's cover image. Its `src` is an ImmutableString, so a new image
 * replaces the old one whole; the description is text, edited together.
 * Images can also be dropped or pasted onto the field.
 */
export function CoverField(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence?: DraftPresence | null;
}) {
  const { handle } = props;
  const cover = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const value = (handle.doc() as Draft).cover;
      if (value === undefined) return null;
      // The object, to start a new description editor if someone else
      // replaces the cover as a whole.
      return `${A.getObjectId(value)} ${String(value.src)}`;
    },
  );
  const [objectId, src] = cover?.split(" ") ?? [null, null];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const use = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage(file);
      handle.change((doc) => {
        const draft = doc as Draft;
        // Keeps the description of the image it replaces.
        if (draft.cover === undefined) {
          draft.cover = { src: new A.ImmutableString(url), alt: "" };
        } else {
          draft.cover.src = new A.ImmutableString(url);
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const remove = () =>
    handle.change((doc) => {
      delete (doc as Draft).cover;
    });

  const onDrop = (event: DragEvent) => {
    const [file] = imageFiles(event.dataTransfer);
    if (file === undefined) return;
    event.preventDefault();
    setDragging(false);
    void use(file);
  };
  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    setDragging(true);
  };
  const onPaste = (event: ClipboardEvent) => {
    const [file] = imageFiles(event.clipboardData);
    if (file === undefined) return;
    event.preventDefault();
    void use(file);
  };

  return (
    <div className={styles.field}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the buttons inside are the accessible way to pick an image; dropping is a shortcut. */}
      <div
        className={[styles.drop, dragging ? styles.dragging : undefined]
          .filter(Boolean)
          .join(" ")}
        data-testid="cover-drop"
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onPaste={onPaste}
      >
        {src === null ? (
          <p className={styles.empty}>
            {uploading ? m.editor_uploading() : m.editor_cover_drop()}
          </p>
        ) : (
          <img
            className={styles.preview}
            src={src}
            alt={m.editor_cover_alt()}
            aria-busy={uploading}
          />
        )}
        <div className={styles.actions}>
          <Button onClick={() => picker.current?.click()} disabled={uploading}>
            {src === null ? m.editor_cover_choose() : m.editor_cover_replace()}
          </Button>
          {src === null ? null : (
            <Button variant="ghost" onClick={remove} disabled={uploading}>
              {m.editor_cover_remove()}
            </Button>
          )}
        </div>
        <input
          ref={picker}
          type="file"
          accept={acceptedImages}
          aria-label={m.editor_cover_file()}
          hidden
          onChange={(event) => {
            void use(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {objectId === null ? null : (
        <>
          <TextEditor
            key={objectId}
            handle={handle}
            path={altPath}
            label={m.editor_cover_description()}
            presence={props.presence ?? null}
          />
          <p className={styles.hint}>{m.editor_cover_hint()}</p>
        </>
      )}
    </div>
  );
}
