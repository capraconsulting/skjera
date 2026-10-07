import type { Site } from "@skjera/documents/api";
import styles from "./Logo.module.css";

/**
 * The site's logo (SITE_LOGO), in the theme's version, or its name: both,
 * unless the logo has the name in it. The images are decorative beside the
 * name, else named by it.
 */
export function Logo(props: { readonly site: Site }) {
  const { logo, name } = props.site;
  if (logo === undefined) return <>{name}</>;
  const alt = logo.includesName ? name : "";
  return (
    <span className={styles.logo}>
      <img
        className={logo.darkSrc === undefined ? styles.image : styles.light}
        src={logo.src}
        alt={alt}
      />
      {logo.darkSrc === undefined ? null : (
        <img className={styles.dark} src={logo.darkSrc} alt={alt} />
      )}
      {logo.includesName ? null : <span>{name}</span>}
    </span>
  );
}
