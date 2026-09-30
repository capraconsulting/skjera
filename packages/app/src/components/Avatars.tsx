import type { PresenceEntry } from "../presence/presence.ts";
import styles from "./Avatars.module.css";

const initials = (name: string) => {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const [first, second] = words;
  return `${first?.[0] ?? "?"}${second?.[0] ?? ""}`;
};

/** Who is here: one avatar per person, however many tabs they have open. */
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
  const hidden = people.length - shown.length;
  return (
    <ul
      className={
        props.small ? `${styles.avatars} ${styles.small}` : styles.avatars
      }
      aria-label={`Here: ${people.map((entry) => entry.user.name).join(", ")}`}
    >
      {shown.map((entry) => (
        <li
          key={entry.userKey}
          className={styles.avatar}
          style={{ background: entry.color }}
          title={entry.user.name}
          data-testid="avatar"
        >
          {initials(entry.user.name)}
        </li>
      ))}
      {hidden > 0 ? (
        <li className={`${styles.avatar} ${styles.more}`}>+{hidden}</li>
      ) : null}
    </ul>
  );
}
