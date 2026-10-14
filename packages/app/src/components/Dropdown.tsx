import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useCallback,
  useId,
  useRef,
} from "react";
import { Link } from "react-router";
import styles from "./Dropdown.module.css";
import { placeUnder } from "./popover.ts";

/**
 * A button ("⋯" unless given another face) that opens its content in a
 * native popover, under the button and aligned to its right edge. The
 * browser closes it on Escape and on clicks outside; `close` closes it from
 * inside, e.g. after an action.
 */
export function Dropdown(props: {
  /** Accessible name of the button, e.g. "Team options". */
  readonly label: string;
  /** What the button shows, instead of "⋯", and how it looks then. */
  readonly trigger?: {
    readonly content: ReactNode;
    readonly className: string | undefined;
    /** Shown on hover. */
    readonly title?: string;
    readonly testId?: string;
  };
  /** Called when the dropdown opens or closes. */
  readonly onToggle?: (open: boolean) => void;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  // Stable, so effects that close the dropdown don't re-run on every render.
  const close = useCallback(() => popover.current?.hidePopover(), []);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        popoverTarget={id}
        className={props.trigger?.className ?? styles.trigger}
        aria-label={props.label}
        title={props.trigger?.title ?? props.label}
        data-testid={props.trigger?.testId}
      >
        {props.trigger?.content ?? <DotsIcon />}
      </button>
      <div
        ref={popover}
        id={id}
        popover="auto"
        className={styles.popover}
        onToggle={(event) => {
          props.onToggle?.(event.newState === "open");
          if (event.newState !== "open") return;
          placeUnder(event.currentTarget, trigger.current, "end");
          // Start with the first field or item, for keyboard users.
          event.currentTarget
            .querySelector<HTMLElement>("input, a, button:not(:disabled)")
            ?.focus();
        }}
      >
        {typeof props.children === "function"
          ? props.children(close)
          : props.children}
      </div>
    </>
  );
}

/** An action in a dropdown. */
export function DropdownItem({
  danger = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly danger?: boolean }) {
  return (
    <button
      type={type}
      className={[styles.item, danger ? styles.danger : undefined, className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/** A link in a dropdown, to another page. */
export function DropdownLink(props: {
  readonly to: string;
  readonly onClick?: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Link to={props.to} className={styles.item} onClick={props.onClick}>
      {props.children}
    </Link>
  );
}

/** A short explanation under an item, e.g. why it is disabled. */
export function DropdownNote({ children }: { readonly children: ReactNode }) {
  return <p className={styles.note}>{children}</p>;
}

const DotsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="5" cy="12" r="2" fill="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <circle cx="19" cy="12" r="2" fill="currentColor" />
  </svg>
);
