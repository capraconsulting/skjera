/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";
import {
  EventDetails,
  OrganizerText,
  plainText,
  type WrittenText,
} from "./OrganizerText.tsx";

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
  /** The organiser's own text, in place of the standard opening. */
  readonly text?: WrittenText;
}

export function Reminder(props: ReminderProps) {
  const { locale, title, when } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={
        props.text === undefined
          ? m.email_reminder_preview({ title, when }, { locale })
          : plainText(props.text.spans)
      }
      reason={m.email_reason_attending(
        { title, site: props.siteName },
        { locale },
      )}
    >
      {props.text === undefined ? (
        <>
          <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
            {m.email_reminder_heading({}, { locale })}
          </Heading>
          <Text style={paragraph}>
            {m.email_greeting({ name: props.name }, { locale })}
          </Text>
          <Text style={paragraph}>
            {m.email_reminder_body({ title, when }, { locale })}
          </Text>
        </>
      ) : (
        <>
          <OrganizerText spans={props.text.spans} site={props.text.site} />
          <EventDetails title={title} when={when} place={props.text.place} />
        </>
      )}
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
