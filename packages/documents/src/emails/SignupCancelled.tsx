/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";
import {
  EventDetails,
  OrganizerText,
  plainText,
  type WrittenText,
} from "./OrganizerText.tsx";

// Sent when someone cancels their signup, with a calendar cancellation that
// takes the event out of their calendar.

export interface SignupCancelledProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  readonly when: string;
  readonly url: string;
  /** The organiser's own text, in place of the standard opening. */
  readonly text?: WrittenText;
}

export function SignupCancelled(props: SignupCancelledProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={
        props.text === undefined
          ? m.email_left_preview({ title }, { locale })
          : plainText(props.text.spans)
      }
      reason={m.email_reason_left({ title, site: props.siteName }, { locale })}
    >
      {props.text === undefined ? (
        <>
          <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
            {m.email_left_heading({}, { locale })}
          </Heading>
          <Text style={paragraph}>
            {m.email_greeting({ name: props.name }, { locale })}
          </Text>
          <Text style={paragraph}>
            {m.email_left_body({ title, when: props.when }, { locale })}
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
      <Text style={paragraph}>{m.email_left_again({}, { locale })}</Text>
      <Button href={props.url} style={button}>
        {m.email_see_event({}, { locale })}
      </Button>
    </Layout>
  );
}

SignupCancelled.PreviewProps = {
  locale: "nn",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)",
  url: "http://localhost:5173/events/1",
} satisfies SignupCancelledProps;

export default SignupCancelled;
