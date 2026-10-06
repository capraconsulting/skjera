/** @jsxRuntime automatic @jsxImportSource react */
import { Heading, Text } from "react-email";
import { Layout, paragraph } from "./Layout.tsx";

// Sent to attendees when an event is deleted before it's over: it won't
// happen. The cancellation attached takes it out of their calendar.

export interface EventCancelledProps {
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When it would have been, written out (see format.ts). */
  readonly when: string;
}

export function EventCancelled(props: EventCancelledProps) {
  return (
    <Layout
      siteName={props.siteName}
      preview={`${props.title} won't happen`}
      reason={`You signed up for ${props.title} on ${props.siteName}.`}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        Event cancelled
      </Heading>
      <Text style={paragraph}>Hi {props.name},</Text>
      <Text style={paragraph}>
        <strong>{props.title}</strong>, {props.when}, which you signed up for,
        is cancelled. The attached cancellation takes it out of your calendar.
      </Text>
    </Layout>
  );
}

EventCancelled.PreviewProps = {
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
} satisfies EventCancelledProps;

export default EventCancelled;
