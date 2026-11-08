import { m } from "@skjera/i18n/messages";
import styles from "./Loading.module.css";

/** Shown while a page's data loads on the first visit. */
export function Loading() {
  return <p className={styles.loading}>{m.common_loading()}</p>;
}
