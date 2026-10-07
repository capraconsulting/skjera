/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Heading, Text } from "react-email";
import type { Locale } from "../Model.ts";
import { Layout, paragraph } from "./Layout.tsx";

// Sent to attendees when an event is deleted before it's over: it won't
// happen. The cancellation attached takes it out of their calendar.

export interface EventCancelledProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When it would have been, written out (see format.ts). */
  readonly when: string;
}

export function EventCancelled(props: EventCancelledProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={m.email_cancelled_preview({ title }, { locale })}
      reason={m.email_reason_signed_up(
        { title, site: props.siteName },
        { locale },
      )}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        {m.email_cancelled_heading({}, { locale })}
      </Heading>
      <Text style={paragraph}>
        {m.email_greeting({ name: props.name }, { locale })}
      </Text>
      <Text style={paragraph}>
        {m.email_cancelled_body({ title, when: props.when }, { locale })}
      </Text>
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
