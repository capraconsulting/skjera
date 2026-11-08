import type { AnchorHTMLAttributes, ButtonHTMLAttributes, Ref } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "default" | "primary" | "danger" | "ghost";

/** A button in one of the app's styles. Defaults to `type="button"`. */
type SharedButtonProps = {
  readonly variant?: ButtonVariant;
  /** Just an icon (give it an aria-label): round. */
  readonly icon?: boolean;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  SharedButtonProps & {
    readonly as?: "button";
    readonly buttonRef?: Ref<HTMLButtonElement>;
  };

type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> &
  SharedButtonProps & { readonly as: "a" };

export function Button(props: ButtonProps): React.JSX.Element;
export function Button(props: AnchorProps): React.JSX.Element;
export function Button(props: ButtonProps | AnchorProps) {
  const { variant = "default", icon = false, className } = props;
  const classes = [
    styles.button,
    variant === "default" ? undefined : styles[variant],
    icon ? styles.icon : undefined,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  if (props.as === "a") {
    const {
      as: _as,
      variant: _variant,
      icon: _icon,
      className: _className,
      ...anchorProps
    } = props;
    return <a className={classes} {...anchorProps} />;
  }
  const {
    as: _as,
    variant: _variant,
    icon: _icon,
    className: _className,
    buttonRef,
    type = "button",
    ...buttonProps
  } = props;
  return (
    <button ref={buttonRef} type={type} className={classes} {...buttonProps} />
  );
}
