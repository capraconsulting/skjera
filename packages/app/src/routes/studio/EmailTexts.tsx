import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import type { DraftPresence } from "../../presence/presence.ts";
import { DraftText } from "./DraftText.tsx";
import styles from "./EmailTexts.module.css";

// The subject and text an organizer can write for each email the event
// sends. An empty field sends the standard email.

const emails = [
  {
    subject: "signedUpSubject",
    text: "signedUpText",
    name: m.studio_email_signed_up,
    subjectLabel: m.studio_email_signed_up_subject,
    textLabel: m.studio_email_signed_up_text,
  },
  {
    subject: "signupCancelledSubject",
    text: "signupCancelledText",
    name: m.studio_email_signup_cancelled,
    subjectLabel: m.studio_email_signup_cancelled_subject,
    textLabel: m.studio_email_signup_cancelled_text,
  },
  {
    subject: "eventChangedSubject",
    text: "eventChangedText",
    name: m.studio_email_event_changed,
    subjectLabel: m.studio_email_event_changed_subject,
    textLabel: m.studio_email_event_changed_text,
  },
  {
    subject: "eventCancelledSubject",
    text: "eventCancelledText",
    name: m.studio_email_event_cancelled,
    subjectLabel: m.studio_email_event_cancelled_subject,
    textLabel: m.studio_email_event_cancelled_text,
  },
] as const;

/** Something is written in the draft: not only spaces and block markers. */
const isWritten = (value: string | undefined) =>
  value !== undefined && value.replace(/[\s￼]+/g, "") !== "";

/**
 * The emails' fields, each opened on request: a field that is never opened
 * is never created in the draft, so an older published event does not turn
 * into one with unpublished changes.
 */
export function EmailTexts(props: {
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  return (
    <div className={styles.emails}>
      {emails.map((email) => (
        <Email key={email.subject} email={email} {...props} />
      ))}
    </div>
  );
}

function Email(props: {
  readonly email: (typeof emails)[number];
  readonly handle: DocHandle<EventContent>;
  readonly presence: DraftPresence | null;
}) {
  const { email, handle, presence } = props;
  // Open from the start when something is already written for it.
  const [open, setOpen] = useState(() => {
    const doc = handle.doc();
    return isWritten(doc[email.subject]) || isWritten(doc[email.text]);
  });
  return (
    <div className={styles.email}>
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {email.name()}
      </Button>
      {open ? (
        <div className={styles.fields}>
          <DraftText
            handle={handle}
            presence={presence}
            field={email.subject}
            label={email.subjectLabel()}
          />
          <DraftText
            handle={handle}
            presence={presence}
            field={email.text}
            label={email.textLabel()}
            rich
          />
          <span className={styles.hint}>{m.studio_email_hint()}</span>
        </div>
      ) : null}
    </div>
  );
}
