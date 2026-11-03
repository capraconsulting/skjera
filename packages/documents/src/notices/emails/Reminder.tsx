/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent the morning before an event to everyone signed up, where the event's
// reminders are on.

export interface ReminderProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When, written out (see format.ts). */
  readonly when: string;
  readonly url: string;
  /** A guest's link to change or cancel their signup. */
  readonly guestLink?: string;
}

export function Reminder(props: ReminderProps) {
  const { locale, title, when } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={m.email_reminder_preview({ title, when }, { locale })}
      reason={m.email_reason_attending(
        { title, site: props.siteName },
        { locale },
      )}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        {m.email_reminder_heading({}, { locale })}
      </Heading>
      <Text style={paragraph}>
        {m.email_greeting({ name: props.name }, { locale })}
      </Text>
      <Text style={paragraph}>
        {m.email_reminder_body({ title, when }, { locale })}
      </Text>
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? m.email_reminder_cancel_member({}, { locale })
          : m.email_reminder_cancel_guest({}, { locale })}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined
          ? m.email_see_event({}, { locale })
          : m.email_your_signup({}, { locale })}
      </Button>
    </Layout>
  );
}

Reminder.PreviewProps = {
  locale: "nn",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
} satisfies ReminderProps;

export default Reminder;
