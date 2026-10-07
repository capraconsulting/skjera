import { m } from "@skjera/i18n/messages";
import { getLocale } from "@skjera/i18n/runtime";
import type { PresenceEntry } from "../presence/presence.ts";
import styles from "./Avatars.module.css";

const initials = (name: string) => {
  const words = name.split(/[\s@._-]+/).filter(Boolean);
  const [first, second] = words;
  return `${first?.[0] ?? "?"}${second?.[0] ?? ""}`;
};

/**
 * Who is here: one avatar per person, however many tabs they have open.
 * Hovering one shows the name below it.
 */
export function Avatars(props: {
  readonly entries: ReadonlyArray<PresenceEntry>;
  readonly max?: number;
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
      className={styles.avatars}
      aria-label={m.studio_here({
        names: new Intl.ListFormat(getLocale()).format(
          people.map((entry) => entry.user.name),
        ),
      })}
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
