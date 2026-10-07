import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** A button in one of the app's styles. Defaults to `type="button"`. */
export function Button({
  variant = "default",
  icon = false,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
  /** Just an icon (give it an aria-label): round. */
  readonly icon?: boolean;
}) {
  const classes = [
    styles.button,
    variant === "default" ? undefined : styles[variant],
    icon ? styles.icon : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...props} />;
}
