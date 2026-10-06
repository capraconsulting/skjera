/** @jsxRuntime automatic @jsxImportSource react */
import { Button, Heading, Text } from "react-email";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent the day before an event to everyone signed up, unless the event's
// organizers turned reminders off.

export interface ReminderProps {
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
  return (
    <Layout
      siteName={props.siteName}
      preview={`${props.title} is coming up: ${props.when}`}
      reason={`You're signed up for ${props.title} on ${props.siteName}.`}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        See you soon
      </Heading>
      <Text style={paragraph}>Hi {props.name},</Text>
      <Text style={paragraph}>
        A reminder: you're signed up for <strong>{props.title}</strong>,{" "}
        {props.when}.
      </Text>
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? "Can't make it after all? You can cancel your signup on the event's page, so others can take your place."
          : "Can't make it after all? Your own link cancels your signup, so others can take your place."}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined ? "See the event" : "Your signup"}
      </Button>
    </Layout>
  );
}

Reminder.PreviewProps = {
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
} satisfies ReminderProps;

export default Reminder;
