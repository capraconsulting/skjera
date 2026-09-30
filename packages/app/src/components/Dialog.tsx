import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./Dialog.module.css";

/**
 * A modal dialog on the native <dialog> element: the browser gives it a
 * backdrop, keeps focus inside, and closes it on Escape.
 */
export function Dialog(props: {
  readonly open: boolean;
  readonly title: string;
  /** Called when the dialog closes itself, e.g. on Escape. */
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  }, [props.open]);

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <h2 id={titleId} className={styles.title}>
        {props.title}
      </h2>
      <div className={styles.body}>{props.open ? props.children : null}</div>
    </dialog>
  );
}

export const dialogStyles = {
  actions: styles.actions,
  error: styles.error,
  input: styles.input,
};
