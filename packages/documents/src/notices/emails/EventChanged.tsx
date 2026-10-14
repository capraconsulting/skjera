/** @jsxRuntime automatic @jsxImportSource react */
import { m } from "@skjera/i18n/messages";
import { Button, Heading, Text } from "react-email";
import type { Locale } from "../../Model.ts";
import { button, Layout, paragraph } from "./Layout.tsx";
import {
  EventDetails,
  OrganizerText,
  plainText,
  type WrittenText,
} from "./OrganizerText.tsx";

// Sent to attendees when an event moves, or is at another place: it starts
// or ends at another time, or somewhere else, or both. The invitation
// attached updates the one in their calendar.

export interface EventChangedProps {
  readonly locale: Locale;
  readonly siteName: string;
  readonly name: string;
  readonly title: string;
  /** When it is now, written out (see format.ts). */
  readonly when: string;
  /** When it was, if it moved. */
  readonly previously?: string;
  /** Where it is now, if the place changed. */
  readonly place?: string;
  /** Where it was, if the place changed: "" when it had none. */
  readonly previousPlace?: string;
  readonly url: string;
  /** A guest's link to change or cancel their signup. */
  readonly guestLink?: string;
  /** The organiser's own text, in place of the standard opening. */
  readonly text?: WrittenText;
}

export function EventChanged(props: EventChangedProps) {
  const { locale, title, when } = props;
  const newPlace = props.place !== undefined;
  const place = props.place ?? "";
  // Moved, unless only the place changed.
  const moved = props.previously !== undefined || !newPlace;
  const was = props.previousPlace ?? "";
  const copy =
    moved && newPlace
      ? {
          preview: m.email_moved_and_new_place_preview(
            { title, when, place },
            { locale },
          ),
          heading: m.email_moved_and_new_place_heading({}, { locale }),
        }
      : newPlace
        ? {
            preview: m.email_new_place_preview({ title, place }, { locale }),
            heading: m.email_new_place_heading({}, { locale }),
          }
        : {
            preview: m.email_moved_preview({ title, when }, { locale }),
            heading: m.email_moved_heading({}, { locale }),
          };
  return (
    <Layout
      locale={locale}
      siteName={props.siteName}
      preview={
        props.text === undefined ? copy.preview : plainText(props.text.spans)
      }
      reason={m.email_reason_attending(
        { title, site: props.siteName },
        { locale },
      )}
    >
      {props.text === undefined ? (
        <>
          <Heading as="h1" style={{ margin: "0 0 16px", fontSize: "22px" }}>
            {copy.heading}
          </Heading>
          <Text style={paragraph}>
            {m.email_greeting({ name: props.name }, { locale })}
          </Text>
          <Text style={paragraph}>
            {moved
              ? m.email_moved_body({ title, when }, { locale })
              : m.email_new_place_body({ title, place }, { locale })}
          </Text>
        </>
      ) : (
        <>
          <OrganizerText spans={props.text.spans} site={props.text.site} />
          <EventDetails title={title} when={when} place={props.text.place} />
        </>
      )}
      {moved ? (
        <Text style={paragraph}>
          {m.email_moved_was(
            { previously: props.previously ?? "" },
            { locale },
          )}
        </Text>
      ) : null}
      {moved && newPlace ? (
        <Text style={paragraph}>
          {m.email_moved_new_place_too({ place }, { locale })}
        </Text>
      ) : null}
      {newPlace && was !== "" ? (
        <Text style={paragraph}>
          {m.email_new_place_was({ previousPlace: was }, { locale })}
        </Text>
      ) : null}
      <Text style={paragraph}>{m.email_calendar_updated({}, { locale })}</Text>
      <Text style={paragraph}>
        {props.guestLink === undefined
          ? m.email_moved_cancel_member({}, { locale })
          : m.email_moved_cancel_guest({}, { locale })}
      </Text>
      <Button href={props.guestLink ?? props.url} style={button}>
        {props.guestLink === undefined
          ? m.email_see_event({}, { locale })
          : m.email_your_signup({}, { locale })}
      </Button>
    </Layout>
  );
}

EventChanged.PreviewProps = {
  locale: "en",
  siteName: "Skjera",
  name: "Gina",
  title: "Launch",
  when: "Friday, October 16, 2026, 6:00 – 9:00 PM (Central European Time)",
  previously:
    "Thursday, October 15, 2026, 6:00 – 9:00 PM (Central European Time)",
  place: "Aula",
  previousPlace: "Kantina",
  url: "http://localhost:5173/events/1",
  guestLink: "http://localhost:5173/events/1?guest=g&token=t",
} satisfies EventChangedProps;

export default EventChanged;
