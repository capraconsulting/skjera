/** @jsxRuntime automatic @jsxImportSource react */
import { Button, Heading, Text } from "react-email";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent when someone signs up, with the event as a calendar invitation.

export interface SignedUpProps {
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
  /** When food is served: until when they can say what they can't eat. */
  readonly dietaryBy?: string;
}

export function SignedUp(props: SignedUpProps) {
  return (
    <Layout
      siteName={props.siteName}
      preview={`See you at ${props.title}`}
      reason={`You signed up for ${props.title} on ${props.siteName}.`}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        You're signed up
      </Heading>
      <Text style={paragraph}>Hi {props.name},</Text>
      <Text style={paragraph}>
        You're signed up for <strong>{props.title}</strong>, {props.when}. It's
        in the invitation attached, for your calendar.
      </Text>
      {props.dietaryBy === undefined ? null : (
        <Text style={paragraph}>
          Food is served. You can change what you told us you can't eat until{" "}
          {props.dietaryBy}.
        </Text>
      )}
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? "Changed your mind? You can change or cancel your signup on the event's page"
          : "Changed your mind? Your own link changes or cancels your signup"}{" "}
        until {props.closes}.
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined ? "See the event" : "Your signup"}
      </Button>
    </Layout>
  );
}

SignedUp.PreviewProps = {
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
  closes: "Thursday, October 15, 2026 at 6:00 PM (Central European Time)",
  dietaryBy: "Tuesday, October 13, 2026 at 12:00 PM (Central European Time)",
} satisfies SignedUpProps;

export default SignedUp;
