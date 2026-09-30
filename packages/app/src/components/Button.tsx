import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** A button in one of the app's styles. Defaults to `type="button"`. */
export function Button({
  variant = "default",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: ButtonVariant;
}) {
  const classes = [
    styles.button,
    variant === "default" ? undefined : styles[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...props} />;
}
