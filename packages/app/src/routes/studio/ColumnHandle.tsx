import type { KeyboardEvent, PointerEvent } from "react";
import styles from "./ColumnHandle.module.css";
import { maxWidth, minWidth } from "./columnWidths.ts";

const remInPixels = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/**
 * The line between two columns, dragged, or moved with the arrow keys, to
 * change the width of the column on its left. A double click puts it back.
 */
export function ColumnHandle(props: {
  readonly label: string;
  /** The column's width, in rem. */
  readonly width: number;
  readonly defaultWidth: number;
  /** Where the line is, from the studio's left edge, as CSS. */
  readonly left: string;
  readonly onResize: (rem: number) => void;
}) {
  const { width, onResize } = props;

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const rem = remInPixels();
    const move = (moved: globalThis.PointerEvent) =>
      onResize(width + (moved.clientX - startX) / rem);
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };

  const keys: Record<string, () => number> = {
    ArrowLeft: () => width - 1,
    ArrowRight: () => width + 1,
    Home: () => minWidth,
    End: () => maxWidth,
  };
  const press = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keys[event.key];
    if (next === undefined) return;
    event.preventDefault();
    onResize(next());
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator that moves is the window splitter pattern; <hr> can't take focus or be dragged.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      tabIndex={0}
      className={styles.handle}
      style={{ left: props.left }}
      onPointerDown={startDrag}
      onKeyDown={press}
      onDoubleClick={() => onResize(props.defaultWidth)}
    />
  );
}
