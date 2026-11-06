/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Fragment } from "react";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent to everyone signed up when an organizer writes to them from the
// studio: the organizer's text, then the event's title and its link.

export interface OrganizerEmailProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly title: string;
  /** What the organizer wrote: paragraphs split by blank lines, line breaks kept. */
  readonly text: string;
  readonly url: string;
}

/** The text's paragraphs, each a list of lines. */
const paragraphsOf = (text: string) =>
  text
    .trim()
    .split(/\r?\n[ \t]*\r?\n/)
    .map((each) => each.split(/\r?\n/));

export function OrganizerEmail(props: OrganizerEmailProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={props.text.trim().replace(/\s+/g, " ").slice(0, 120)}
      reason={m.email_reason_attending(
        { title, site: props.siteName },
        { locale },
      )}
    >
      {paragraphsOf(props.text).map((lines, index) => (
        <Text key={index} style={paragraph}>
          {lines.map((line, at) => (
            <Fragment key={at}>
              {at === 0 ? null : <br />}
              {line}
            </Fragment>
          ))}
        </Text>
      ))}
      <Heading as="h2" style={{ margin: "24px 0 16px", fontSize: "18px" }}>
        {title}
      </Heading>
      <Button href={props.url} style={button}>
        {m.email_see_event({}, { locale })}
      </Button>
    </Layout>
  );
}

OrganizerEmail.PreviewProps = {
  locale: "nb",
  siteName: "Skjera",
  title: "Lansering",
  text: "Vi er i rom 3.\n\nTa med lader.",
  url: "https://skjera.example/events/1",
} satisfies OrganizerEmailProps;
