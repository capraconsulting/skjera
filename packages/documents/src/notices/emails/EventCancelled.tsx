/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Heading, Text } from "react-email";
import type { Locale } from "../../Model.ts";
import { Layout, paragraph } from "./Layout.tsx";
import {
  EventDetails,
  OrganizerText,
  plainText,
  type WrittenText,
} from "./OrganizerText.tsx";

// Sent to attendees when an event is deleted before it's over: it won't
// happen. The cancellation attached takes it out of their calendar.

export interface EventCancelledProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When it would have been, written out (see format.ts). */
  readonly when: string;
  /** The organiser's own text, in place of the standard opening. */
  readonly text?: WrittenText;
}

export function EventCancelled(props: EventCancelledProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={
        props.text === undefined
          ? m.email_cancelled_preview({ title }, { locale })
          : plainText(props.text.spans)
      }
      reason={m.email_reason_signed_up(
        { title, site: props.siteName },
        { locale },
      )}
    >
      {props.text === undefined ? (
        <>
          <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
            {m.email_cancelled_heading({}, { locale })}
          </Heading>
          <Text style={paragraph}>
            {m.email_greeting({ name: props.name }, { locale })}
          </Text>
          <Text style={paragraph}>
            {m.email_cancelled_body({ title, when: props.when }, { locale })}
          </Text>
        </>
      ) : (
        <>
          <OrganizerText spans={props.text.spans} site={props.text.site} />
          <EventDetails
            title={title}
            when={props.when}
            place={props.text.place}
          />
          <Text style={paragraph}>
            {m.email_organizer_calendar_removed({}, { locale })}
          </Text>
        </>
      )}
    </Layout>
  );
}

EventCancelled.PreviewProps = {
  locale: "nb",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)",
} satisfies EventCancelledProps;

export default EventCancelled;
