import type { DocHandle } from "@automerge/automerge-repo/slim";
import type { EventContent } from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { useState } from "react";
import { Button } from "../../../components/controls/Button.tsx";
import type { DraftPresence } from "../../../presence/presence.ts";
import { DraftText } from "../DraftText.tsx";
import styles from "./EmailTexts.module.css";
import { emails, opensFromStart } from "./emailTexts.ts";

// The subject and text an organizer can write for each email the event
// sends. An empty field sends the standard email.

/**
 * The emails' fields. A field is created in the draft when the organizer goes
 * into it, or, for an email that started closed, when it is opened: showing a
 * field writes nothing, so an older published event does not turn into one
 * with unpublished changes.
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
  const [startedOpen] = useState(() => opensFromStart(handle.doc(), email));
  const [open, setOpen] = useState(startedOpen);
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
            createOnFocus={startedOpen}
          />
          <DraftText
            handle={handle}
            presence={presence}
            field={email.text}
            label={email.textLabel()}
            rich
            createOnFocus={startedOpen}
          />
          <span className={styles.hint}>{m.studio_email_hint()}</span>
        </div>
      ) : null}
    </div>
  );
}
