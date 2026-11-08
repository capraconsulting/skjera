import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";
import styles from "./Input.module.css";

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={[styles.input, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={[styles.input, className].filter(Boolean).join(" ")}
      {...props}
    />
  );
}
