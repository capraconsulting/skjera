import { m } from "@skjera/i18n/messages";
import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { Dialog, dialogStyles } from "../components/Dialog.tsx";
import { coverCropStyles } from "./CoverCrop.tsx";
import {
  type Frame,
  focusInPart,
  focusInShown,
  keyFocus,
  type Point,
  pointInPicture,
} from "./cropFrame.ts";

const percent = (share: number) => `${share * 100}%`;

/**
 * The dialog that lets the organiser choose the point of the cover that must
 * stay in view: a click in the part shown, or the arrow keys. The point is
 * handed over as shares of the whole picture.
 */
export function CoverFocus(props: {
  readonly open: boolean;
  /** The part shown, as the site serves it: the cropped file, else the picture. */
  readonly src: string;
  /** The part of the picture shown; null: the whole picture. */
  readonly crop: Frame | null;
  /** The focal point now, as shares of the whole picture; null: none. */
  readonly focus: Point | null;
  readonly onClose: () => void;
  readonly onApply: (point: Point) => void;
}) {
  return (
    <Dialog
      open={props.open}
      title={m.editor_cover_focus_title()}
      onClose={props.onClose}
    >
      <Chooser {...props} />
    </Dialog>
  );
}

/** Mounted while the dialog is open: each opening starts from the point set. */
function Chooser(props: {
  readonly src: string;
  readonly crop: Frame | null;
  readonly focus: Point | null;
  readonly onClose: () => void;
  readonly onApply: (point: Point) => void;
}) {
  const [point, setPoint] = useState<Point>(
    focusInPart(props.focus ?? { x: 0.5, y: 0.5 }, props.crop),
  );
  const area = useRef<HTMLDivElement>(null);

  const click = (event: PointerEvent<HTMLDivElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (box === undefined) return;
    setPoint(
      pointInPicture(
        { x: event.clientX - box.left, y: event.clientY - box.top },
        box,
      ),
    );
  };
  const press = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = keyFocus(point, event.key);
    if (next === point) return;
    event.preventDefault();
    setPoint(next);
  };

  return (
    <>
      <p className={coverCropStyles.hint}>{m.editor_cover_focus_hint()}</p>
      <div
        ref={area}
        className={`${coverCropStyles.area} ${coverCropStyles.focus}`}
        data-testid="focus-picture"
        onPointerDown={click}
      >
        <img className={coverCropStyles.picture} src={props.src} alt="" />
        <button
          type="button"
          aria-label={m.editor_cover_focus()}
          className={coverCropStyles.marker}
          style={{ left: percent(point.x), top: percent(point.y) }}
          onKeyDown={press}
        />
      </div>
      <div className={dialogStyles.actions}>
        <Button onClick={props.onClose}>{m.common_cancel()}</Button>
        <Button
          variant="primary"
          onClick={() => props.onApply(focusInShown(point, props.crop))}
        >
          {m.editor_cover_apply()}
        </Button>
      </div>
    </>
  );
}
