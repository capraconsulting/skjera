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

// Sent when someone signs up, with the event as a calendar invitation.

export interface SignedUpProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When, written out (see format.ts). */
  readonly when: string;
  readonly url: string;
  /** A guest's link to change or cancel their signup. */
  readonly guestLink?: string;
  /** Until when sign-up, and so changing it, is open. */
  readonly closes: string;
  /** Food is served. */
  readonly food?: boolean;
  /** The organiser's own text, in place of the standard opening. */
  readonly text?: WrittenText;
}

export function SignedUp(props: SignedUpProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={
        props.text === undefined
          ? m.email_signed_up_preview({ title }, { locale })
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
            {m.email_signed_up_heading({}, { locale })}
          </Heading>
          <Text style={paragraph}>
            {m.email_greeting({ name: props.name }, { locale })}
          </Text>
          <Text style={paragraph}>
            {m.email_signed_up_body({ title, when: props.when }, { locale })}
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
            {m.email_organizer_calendar_invited({}, { locale })}
          </Text>
        </>
      )}
      {props.food === true ? (
        <Text style={paragraph}>{m.email_signed_up_food({}, { locale })}</Text>
      ) : null}
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? m.email_signed_up_change_member({ until: props.closes }, { locale })
          : m.email_signed_up_change_guest({ until: props.closes }, { locale })}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined
          ? m.email_see_event({}, { locale })
          : m.email_your_signup({}, { locale })}
      </Button>
    </Layout>
  );
}

SignedUp.PreviewProps = {
  locale: "nb",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
  closes: "torsdag 15. oktober 2026 kl. 18:00 (sentraleuropeisk tid)",
  food: true,
} satisfies SignedUpProps;

export default SignedUp;
