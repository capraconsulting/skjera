/** @jsxRuntime automatic @jsxImportSource react */
import { Button, Heading, Text } from "react-email";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent when someone cancels their signup, with a calendar cancellation that
// takes the event out of their calendar.

export interface SignupCancelledProps {
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  readonly when: string;
  readonly url: string;
}

export function SignupCancelled(props: SignupCancelledProps) {
  return (
    <Layout
      siteName={props.siteName}
      preview={`You're no longer signed up for ${props.title}`}
      reason={`You cancelled your signup for ${props.title} on ${props.siteName}.`}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        Signup cancelled
      </Heading>
      <Text style={paragraph}>Hi {props.name},</Text>
      <Text style={paragraph}>
        You're no longer signed up for <strong>{props.title}</strong>,{" "}
        {props.when}. The attached cancellation takes it out of your calendar.
      </Text>
      <Text style={paragraph}>
        Changed your mind again? You can sign up on the event's page while
        sign-up is open.
      </Text>
      <Button href={props.url} style={button}>
        See the event
      </Button>
    </Layout>
  );
}

SignupCancelled.PreviewProps = {
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
  url: "http://localhost:5173/events/1",
} satisfies SignupCancelledProps;

export default SignupCancelled;
