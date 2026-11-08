import { m } from "@skjera/i18n/messages";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Button } from "../../components/controls/Button.tsx";
import { Dialog, dialogStyles } from "../../components/controls/Dialog.tsx";
import styles from "./CoverCrop.module.css";

export const coverCropStyles = {
  area: styles.area,
  focus: styles.focus,
  hint: styles.hint,
  marker: styles.marker,
  picture: styles.picture,
};

import {
  drawFrame,
  type Frame,
  keyFrame,
  moveFrame,
  type Point,
  pointInPicture,
} from "./cropFrame.ts";

const whole: Frame = { x: 0, y: 0, width: 1, height: 1 };

const percent = (share: number) => `${share * 100}%`;

/**
 * The dialog that lets the organiser choose the part of the cover's picture to
 * use: a frame, drawn by dragging over the picture, moved by dragging inside
 * it, and moved or resized with the arrow keys.
 */
export function CoverCrop(props: {
  readonly open: boolean;
  /** The picture, as the site serves it. */
  readonly src: string;
  /** The part used now; null: the whole picture. */
  readonly crop: Frame | null;
  readonly onClose: () => void;
  readonly onApply: (frame: Frame) => void;
}) {
  return (
    <Dialog
      open={props.open}
      title={m.editor_cover_crop_title()}
      onClose={props.onClose}
    >
      <Cropper {...props} />
    </Dialog>
  );
}

type Gesture =
  | { readonly kind: "draw"; readonly from: Point }
  | { readonly kind: "move"; readonly from: Point; readonly frame: Frame };

/** Mounted while the dialog is open: each opening starts from the part used. */
function Cropper(props: {
  readonly src: string;
  readonly crop: Frame | null;
  readonly onClose: () => void;
  readonly onApply: (frame: Frame) => void;
}) {
  const [frame, setFrame] = useState<Frame>(props.crop ?? whole);
  const area = useRef<HTMLDivElement>(null);
  const frameElement = useRef<HTMLButtonElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const at = (event: PointerEvent): Point => {
    const box = area.current?.getBoundingClientRect();
    if (box === undefined) return { x: 0, y: 0 };
    return pointInPicture(
      { x: event.clientX - box.left, y: event.clientY - box.top },
      box,
    );
  };

  // A frame as large as the picture can't be moved, so a drag draws a new one.
  const canMove = frame.width < 1 || frame.height < 1;

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const from = at(event);
    const inside =
      canMove &&
      event.target instanceof Node &&
      frameElement.current?.contains(event.target) === true;
    gesture.current = inside
      ? { kind: "move", from, frame }
      : { kind: "draw", from };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (current === null) return;
    const to = at(event);
    setFrame(
      current.kind === "draw"
        ? drawFrame(current.from, to)
        : moveFrame(
            current.frame,
            to.x - current.from.x,
            to.y - current.from.y,
          ),
    );
  };
  const stop = () => {
    gesture.current = null;
  };

  const press = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = keyFrame(frame, event.key, event.shiftKey);
    if (next === frame) return;
    event.preventDefault();
    setFrame(next);
  };

  return (
    <>
      <p className={styles.hint}>{m.editor_cover_crop_hint()}</p>
      <div
        ref={area}
        className={styles.area}
        data-testid="crop-picture"
        onPointerDown={start}
        onPointerMove={drag}
        onPointerUp={stop}
        onPointerCancel={stop}
      >
        <img className={styles.picture} src={props.src} alt="" />
        <button
          type="button"
          ref={frameElement}
          aria-label={m.editor_cover_crop_frame()}
          className={styles.frame}
          style={{
            left: percent(frame.x),
            top: percent(frame.y),
            width: percent(frame.width),
            height: percent(frame.height),
          }}
          onKeyDown={press}
        />
      </div>
      <div className={dialogStyles.actions}>
        <Button onClick={props.onClose}>{m.common_cancel()}</Button>
        <Button variant="primary" onClick={() => props.onApply(frame)}>
          {m.editor_cover_apply()}
        </Button>
      </div>
    </>
  );
}
