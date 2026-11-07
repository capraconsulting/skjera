import { m } from "@skjera/i18n/messages";
import { appPaths } from "@skjera/paths";
import { CalendarPlus } from "lucide-react";
import styles from "./SubscribeLink.module.css";

/** Google Calendar, asked to subscribe to the site's calendar of coming events. */
const subscribeUrl = appPaths.googleCalendarSubscription;

/**
 * Subscribing to the coming events in Google Calendar, beside the account
 * menu: Google opens in a new tab, with the calendar at the host the page is
 * served from.
 */
export function SubscribeLink() {
  const label = m.common_subscribe();
  return (
    <a
      href={subscribeUrl(window.location.host)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
    >
      <span className={styles.word}>{label}</span>
      <CalendarPlus size={16} strokeWidth={1.5} aria-hidden="true" />
    </a>
  );
}
