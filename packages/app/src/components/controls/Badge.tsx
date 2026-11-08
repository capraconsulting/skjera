import type { ReactNode } from "react";
import styles from "./Badge.module.css";

export function Badge(props: {
  readonly tone: "neutral" | "success" | "warning" | "highlight";
  readonly children: ReactNode;
}) {
  return (
    <span className={`${styles.badge} ${styles[props.tone]}`}>
      {props.children}
    </span>
  );
}
