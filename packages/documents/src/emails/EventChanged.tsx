/** @jsxRuntime automatic @jsxImportSource react */
import { Button, Heading, Text } from "react-email";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent to attendees when an event moves: it starts or ends at another time.
// The invitation attached updates the one in their calendar.

export interface EventChangedProps {
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
  return (
    <Layout
      siteName={props.siteName}
      preview={`${props.title} is now ${props.when}`}
      reason={`You're signed up for ${props.title} on ${props.siteName}.`}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        New time
      </Heading>
      <Text style={paragraph}>Hi {props.name},</Text>
      <Text style={paragraph}>
        <strong>{props.title}</strong>, which you're signed up for, has moved.
        It's now {props.when}.
      </Text>
      <Text style={paragraph}>
        It was {props.previously}. The invitation attached updates it in your
        calendar.
      </Text>
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? "Can't make it now? You can cancel your signup on the event's page."
          : "Can't make it now? Your own link cancels your signup."}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined ? "See the event" : "Your signup"}
      </Button>
    </Layout>
  );
}

EventChanged.PreviewProps = {
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
