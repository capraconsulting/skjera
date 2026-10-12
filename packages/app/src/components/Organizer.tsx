import { type EventRow, organizerLogos } from "@skjera/documents/api";
import styles from "./Organizer.module.css";

/**
 * An event's organizer: its team's logo in the theme's version, named by the
 * team's name, or the name itself where the theme has no logo. The dark theme
 * takes the light logo when there's no dark one; the light theme never takes
 * the dark one.
 */
export function Organizer(props: {
  readonly organizer: EventRow["organizer"];
}) {
  const { organizer } = props;
  const { light, dark } = organizerLogos(organizer);
  const { name } = organizer;
  const shown = (src: string | null, className: string | undefined) =>
    src === null ? (
      <span className={className}>{name}</span>
    ) : (
      <img className={className} src={src} alt={name} />
    );
  // The same in both themes: one element.
  if (light === dark) {
    return shown(light, light === null ? undefined : styles.logo);
  }
  return (
    <>
      {shown(light, light === null ? styles.light : styles.lightLogo)}
      {shown(dark, dark === null ? styles.dark : styles.darkLogo)}
    </>
  );
}
