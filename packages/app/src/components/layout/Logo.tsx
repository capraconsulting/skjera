import type { Site } from "@skjera/documents/api";
// Named for their colour: the dark logo is for the light theme.
import logoForLight from "../../assets/logo/logo-dark.webp";
import logoForLightSmall from "../../assets/logo/logo-dark-sm.webp";
import logoForDark from "../../assets/logo/logo-light.webp";
import logoForDarkSmall from "../../assets/logo/logo-light-sm.webp";
import logoStill from "../../assets/logo/logo-reduced-motion.webp";
import styles from "./Logo.module.css";
import { wantsSmallLogo } from "./smallLogo.ts";

const small = wantsSmallLogo(navigator.userAgent);

/**
 * Capra's and Liflig's logo, named by the site: animated, in the theme's
 * version, or still for those who ask for less motion.
 */
export function Logo(props: { readonly site: Site }) {
  const alt = props.site.name;
  return (
    <span className={styles.logo}>
      <span className={styles.animated}>
        <img
          className={styles.light}
          src={small ? logoForLightSmall : logoForLight}
          alt={alt}
          fetchPriority="high"
        />
        <img
          className={styles.dark}
          src={small ? logoForDarkSmall : logoForDark}
          alt={alt}
          fetchPriority="high"
        />
      </span>
      <img className={styles.still} src={logoStill} alt={alt} />
    </span>
  );
}
