/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import { cancelLinkHours, type Locale } from "../../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";

// Sent when a guest asks to cancel by their email address: the link in it
// cancels their signup once its button is pressed, for the configured hours.

export interface CancelRequestedProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  readonly when: string;
  /** The page where the button that cancels is. */
  readonly url: string;
}

export function CancelRequested(props: CancelRequestedProps) {
  const { locale, title } = props;
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={m.email_cancel_requested_preview({ title }, { locale })}
      reason={m.email_reason_cancel_requested(
        { title, site: props.siteName },
        { locale },
      )}
    >
      <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
        {m.email_cancel_requested_heading({}, { locale })}
      </Heading>
      <Text style={paragraph}>
        {m.email_greeting({ name: props.name }, { locale })}
      </Text>
      <Text style={paragraph}>
        {m.email_cancel_requested_body(
          { title, when: props.when, hours: cancelLinkHours },
          { locale },
        )}
      </Text>
      <Button href={props.url} style={button}>
        {m.email_cancel_requested_button({}, { locale })}
      </Button>
    </Layout>
  );
}

CancelRequested.PreviewProps = {
  locale: "nn",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "torsdag 15. oktober 2026, 18:00–21:00 (sentraleuropeisk tid)",
  url: "http://localhost:5173/events/1/cancel?token=abc",
} satisfies CancelRequestedProps;

export default CancelRequested;
