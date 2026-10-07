/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent to attendees when an event moves: it starts or ends at another time.
// The invitation attached updates the one in their calendar.

export interface EventChangedProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When it is now, written out (see format.ts). */
  readonly when: string;
  /** When it was. */
  readonly previously: string;
  readonly url: string;
  /** A guest's link to change or cancel their signup. */
  readonly guestLink?: string;
}

export function EventChanged(props: EventChangedProps) {
  const { locale, title, when } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={m.email_moved_preview({ title, when }, { locale })}
      reason={m.email_reason_attending(
        { title, site: props.siteName },
        { locale },
      )}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        {m.email_moved_heading({}, { locale })}
      </Heading>
      <Text style={paragraph}>
        {m.email_greeting({ name: props.name }, { locale })}
      </Text>
      <Text style={paragraph}>
        {m.email_moved_body({ title, when }, { locale })}
      </Text>
      <Text style={paragraph}>
        {m.email_moved_was({ previously: props.previously }, { locale })}
      </Text>
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? m.email_moved_cancel_member({}, { locale })
          : m.email_moved_cancel_guest({}, { locale })}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined
          ? m.email_see_event({}, { locale })
          : m.email_your_signup({}, { locale })}
      </Button>
    </Layout>
  );
}

EventChanged.PreviewProps = {
  locale: "en",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Friday, October 16, 2026, 6:00 – 9:00 PM (Central European Time)",
  previously:
    "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
} satisfies EventChangedProps;

export default EventChanged;
