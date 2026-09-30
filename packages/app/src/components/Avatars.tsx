import type { PresenceEntry } from "../presence/presence.ts";
import styles from "./Avatars.module.css";

const initials = (name: string) => {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const [first, second] = words;
  return `${first?.[0] ?? "?"}${second?.[0] ?? ""}`;
};

/**
 * Who is here: one avatar per person, however many tabs they have open.
 * Hovering one shows the name: below it, or to its left when `small`, since
 * small ones sit at the end of list rows.
 */
export function Avatars(props: {
  readonly entries: ReadonlyArray<PresenceEntry>;
  readonly max?: number;
  readonly small?: boolean;
}) {
  const people = [
    ...new Map(props.entries.map((entry) => [entry.userKey, entry])).values(),
  ];
  if (people.length === 0) return null;
  const max = props.max ?? 3;
  const shown = people.slice(0, max);
  const hidden = people.slice(max);
  return (
    <ul
      className={[styles.avatars, props.small ? styles.small : styles.large]
        .filter(Boolean)
        .join(" ")}
      aria-label={`Here: ${people.map((entry) => entry.user.name).join(", ")}`}
    >
      {shown.map((entry) => (
        <li
          key={entry.userKey}
          className={styles.avatar}
          style={{ background: entry.color }}
          aria-label={entry.user.name}
          data-testid="avatar"
        >
          <span aria-hidden="true">{initials(entry.user.name)}</span>
          <span className={styles.tooltip} aria-hidden="true">
            {entry.user.name}
          </span>
        </li>
      ))}
      {hidden.length > 0 ? (
        <li className={`${styles.avatar} ${styles.more}`}>
          +{hidden.length}
          <span className={styles.tooltip} aria-hidden="true">
            {hidden.map((entry) => entry.user.name).join(", ")}
          </span>
        </li>
      ) : null}
    </ul>
  );
}
