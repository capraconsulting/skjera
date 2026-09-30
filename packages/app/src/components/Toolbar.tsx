import type { ReactNode } from "react";
import styles from "./Toolbar.module.css";

/** A row with its content spread to both ends. */
export function Toolbar({ children }: { readonly children: ReactNode }) {
  return <div className={styles.toolbar}>{children}</div>;
}
