/** @jsxRuntime automatic @jsxImportSource react */
import type { ReactNode } from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "react-email";
import type { Locale } from "../Model.ts";

// What every email is in: the site's name, the content, and why it came.

const body = {
  margin: 0,
  backgroundColor: "#f6f6f4",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: "#1f2328",
};

const card = {
  maxWidth: "560px",
  margin: "32px auto",
  padding: "32px",
  backgroundColor: "#ffffff",
  borderRadius: "8px",
};

export function Layout(props: {
  readonly locale: Locale;
  readonly siteName: string;
  /** Shown in inboxes after the subject. */
  readonly preview: string;
  /** Why this email came. */
  readonly reason: string;
  readonly children: ReactNode;
}) {
  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Text
            style={{ margin: "0 0 24px", fontSize: "14px", fontWeight: 600 }}
          >
            {props.siteName}
          </Text>
          <Section>{props.children}</Section>
          <Hr style={{ margin: "32px 0 16px", borderColor: "#e4e4e0" }} />
          <Text style={{ margin: 0, fontSize: "12px", color: "#6b6f76" }}>
            {props.reason}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export const paragraph = {
  margin: "0 0 16px",
  fontSize: "15px",
  lineHeight: "24px",
};

export const button = {
  display: "inline-block",
  padding: "10px 18px",
  borderRadius: "6px",
  backgroundColor: "#1f2328",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
};
