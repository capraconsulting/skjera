import * as A from "@automerge/automerge/slim";
import type { DocHandle } from "@automerge/automerge-repo/slim";
import {
  type EventContent,
  shownCover,
  shownCoverData,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import {
  type ClipboardEvent,
  type DragEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "../components/Button.tsx";
import type { DraftPresence } from "../presence/presence.ts";
import { CoverCrop } from "./CoverCrop.tsx";
import styles from "./CoverField.module.css";
import { CoverFocus } from "./CoverFocus.tsx";
import {
  type Draft,
  resetCropAndFocus,
  setCrop,
  setFocus,
  setPicture,
} from "./coverEdits.ts";
import type { Frame, Point } from "./cropFrame.ts";
import { cropImage } from "./cropImage.ts";
import { ImagePicker } from "./ImagePicker.tsx";
import { TextEditor } from "./text/TextEditor.tsx";
import { acceptedImages, imageFiles, uploadImage } from "./uploadImage.ts";

const altPath = ["cover", "alt"] as const;

/** The cover as the field reads it: addresses as strings. */
type ShownDraft = {
  readonly id: string;
  readonly src: string;
  readonly crop:
    | (Frame & { readonly from: string; readonly src: string })
    | null;
  readonly focus: (Point & { readonly from: string | null }) | null;
};

/**
 * An event's cover image. Its `src` is an ImmutableString, so a new image
 * replaces the old one whole; the description is text, edited together.
 * Images can also be dropped or pasted onto the field. The organiser can crop
 * the picture (the part is uploaded as an image of its own) and choose the
 * point that must stay in view.
 */
export function CoverField(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence?: DraftPresence | null;
}) {
  const { handle } = props;
  const snapshot = useSyncExternalStore(
    (onChange) => {
      handle.on("change", onChange);
      return () => handle.off("change", onChange);
    },
    () => {
      const value = (handle.doc() as Draft).cover;
      if (value === undefined) return null;
      const crop = value.crop as
        | (Frame & { from: unknown; src: unknown })
        | undefined;
      const focus = value.focus as (Point & { from?: unknown }) | undefined;
      return JSON.stringify({
        // The object, to start a new description editor if someone else
        // replaces the cover as a whole.
        id: String(A.getObjectId(value)),
        src: String(value.src),
        crop:
          crop === undefined
            ? null
            : {
                x: crop.x,
                y: crop.y,
                width: crop.width,
                height: crop.height,
                from: String(crop.from),
                src: String(crop.src),
              },
        focus:
          focus === undefined
            ? null
            : {
                x: focus.x,
                y: focus.y,
                from: focus.from === undefined ? null : String(focus.from),
              },
      } satisfies ShownDraft);
    },
  );
  const cover = useMemo(
    () => (snapshot === null ? null : (JSON.parse(snapshot) as ShownDraft)),
    [snapshot],
  );
  const objectId = cover?.id ?? null;
  const src = cover?.src ?? null;
  const filtered =
    cover === null
      ? null
      : shownCoverData({
          src: cover.src,
          alt: "",
          ...(cover.crop === null ? {} : { crop: cover.crop }),
          ...(cover.focus === null
            ? {}
            : {
                focus: {
                  x: cover.focus.x,
                  y: cover.focus.y,
                  ...(cover.focus.from === null
                    ? {}
                    : { from: cover.focus.from }),
                },
              }),
        });
  const crop = filtered?.crop ?? null;
  const focus =
    filtered?.focus === undefined
      ? null
      : { x: filtered.focus.x, y: filtered.focus.y };
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [focusing, setFocusing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const choosePicture = (url: string) =>
    handle.change((doc) => setPicture(doc as Draft, url));

  // What the site shows of the cover: the cropped part, else the picture.
  const shown =
    src === null
      ? null
      : shownCover({
          src,
          alt: "",
          ...(crop === null ? {} : { crop }),
          ...(focus === null ? {} : { focus }),
        });

  const use = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setUploading(true);
    try {
      choosePicture(await uploadImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const applyCrop = async (frame: Frame) => {
    setCropping(false);
    if (src === null) return;
    // Nothing to cut: the whole picture, and no part cut from it before.
    if (crop === null && frame.width >= 1 && frame.height >= 1) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadImage(await cropImage(src, frame));
      // Not written if the picture was replaced while the part was cut.
      handle.change((doc) => {
        setCrop(doc as Draft, { ...frame, from: src, src: url });
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(false);
    }
  };

  const applyFocus = (point: Point) => {
    setFocusing(false);
    handle.change((doc) => {
      setFocus(doc as Draft, point);
    });
  };

  const reset = () => handle.change((doc) => resetCropAndFocus(doc as Draft));

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
        {src === null || shown === null ? (
          <p className={styles.empty}>
            {uploading ? m.editor_uploading() : m.editor_cover_drop()}
          </p>
        ) : (
          <img
            className={styles.preview}
            src={shown.src}
            style={{ objectPosition: shown.position }}
            alt={m.editor_cover_alt()}
            aria-busy={uploading}
          />
        )}
        <div className={styles.actions}>
          <Button onClick={() => picker.current?.click()} disabled={uploading}>
            {src === null ? m.editor_cover_choose() : m.editor_cover_replace()}
          </Button>
          <Button onClick={() => setPicking(true)} disabled={uploading}>
            {m.editor_existing_pick()}
          </Button>
          {src === null ? null : (
            <>
              <Button onClick={() => setCropping(true)} disabled={uploading}>
                {m.editor_cover_crop()}
              </Button>
              <Button onClick={() => setFocusing(true)} disabled={uploading}>
                {m.editor_cover_focus()}
              </Button>
            </>
          )}
          {crop === null && focus === null ? null : (
            <Button variant="ghost" onClick={reset} disabled={uploading}>
              {m.editor_cover_reset()}
            </Button>
          )}
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
      <ImagePicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={choosePicture}
      />
      {src === null || shown === null ? null : (
        <>
          <CoverCrop
            open={cropping}
            src={src}
            crop={crop}
            onClose={() => setCropping(false)}
            onApply={(frame) => void applyCrop(frame)}
          />
          <CoverFocus
            open={focusing}
            src={shown.src}
            crop={crop}
            focus={focus}
            onClose={() => setFocusing(false)}
            onApply={applyFocus}
          />
        </>
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
