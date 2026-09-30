import { Fragment } from "react";
import { Link } from "react-router";
import styles from "./Breadcrumbs.module.css";

/** Links to the pages above the current one. */
export function Breadcrumbs(props: {
  readonly items: ReadonlyArray<{
    readonly to: string;
    readonly label: string;
  }>;
}) {
  return (
    <nav aria-label="Breadcrumbs" className={styles.breadcrumbs}>
      {props.items.map((item, index) => (
        <Fragment key={item.to}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          <Link to={item.to}>{item.label}</Link>
        </Fragment>
      ))}
    </nav>
  );
}
