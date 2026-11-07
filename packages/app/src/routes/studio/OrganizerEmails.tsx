import {
  type DocumentId,
  describe,
  organizerEmailMissingField,
  organizerEmailSubjectLength,
  organizerEmailTextLength,
  type SentEmail,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog, dialogStyles } from "../../components/Dialog.tsx";
import { Input } from "../../components/Input.tsx";
import type { AppError } from "../../site/client.ts";
import { emailAttendees, organizerEmails } from "../../sync/tables.ts";
import { formatClockIn, formatDateIn, localTimeZone } from "../../time.ts";
import styles from "./Attendees.module.css";

/**
 * The button that writes to everyone signed up, and the form it opens: a
 * subject and a text, and how many it goes to. Asks before sending.
 */
export function EmailAttendees(props: {
  readonly id: DocumentId;
  readonly recipients: number;
  readonly onSent: (email: SentEmail) => void;
}) {
  const { id, recipients, onSent } = props;
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  /** Why it was refused, by the field it belongs to. */
  const [refusal, setRefusal] = useState<{
    readonly field: "subject" | "text";
    readonly message: string;
  } | null>(null);
  /** Any other failure. */
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const messageId = useId();
  const subjectId = useId();
  const textId = useId();

  const close = () => {
    setOpen(false);
    setRefusal(null);
    setError(null);
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setError(null);
    // The same check as the server's, so nobody is asked to confirm what it refuses.
    const missing = organizerEmailMissingField({ subject, text });
    if (missing !== null) {
      setRefusal({
        field: missing,
        message: describe({
          _tag:
            missing === "subject" ? "EmailSubjectMissing" : "EmailTextMissing",
        }),
      });
      return;
    }
    if (!window.confirm(m.studio_email_confirm({ count: recipients }))) return;
    setBusy(true);
    emailAttendees(id, { subject, text }).then(
      (sent) => {
        onSent(sent);
        setSending(sent.recipients);
        setSubject("");
        setText("");
        setBusy(false);
        close();
      },
      (failure: AppError) => {
        const problem = failure.problem;
        if (problem?._tag === "EmailSubjectMissing") {
          setRefusal({ field: "subject", message: describe(problem) });
        } else if (problem?._tag === "EmailTextMissing") {
          setRefusal({ field: "text", message: describe(problem) });
        } else {
          setError(failure.message);
        }
        setBusy(false);
      },
    );
  };

  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          setSending(null);
          setOpen(true);
        }}
      >
        {m.studio_email_attendees()}
      </Button>
      {sending === null ? null : (
        <p role="status" className={styles.sending}>
          {m.studio_email_sending({ count: sending })}
        </p>
      )}
      <Dialog open={open} title={m.studio_email_attendees()} onClose={close}>
        <form className={styles.emailForm} onSubmit={send} noValidate>
          <p className={styles.hint}>
            {m.studio_email_goes_to({ count: recipients })}
          </p>
          <div className={styles.field}>
            <label htmlFor={subjectId}>{m.studio_email_subject()}</label>
            <Input
              id={subjectId}
              name="subject"
              maxLength={organizerEmailSubjectLength}
              aria-invalid={refusal?.field === "subject" ? true : undefined}
              aria-describedby={
                refusal?.field === "subject" ? messageId : undefined
              }
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={textId}>{m.studio_email_text()}</label>
            <textarea
              id={textId}
              name="text"
              className={styles.textarea}
              rows={8}
              maxLength={organizerEmailTextLength}
              aria-invalid={refusal?.field === "text" ? true : undefined}
              aria-describedby={
                refusal?.field === "text" ? messageId : undefined
              }
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          {refusal === null ? null : (
            <p id={messageId} className={dialogStyles.error}>
              {refusal.message}
            </p>
          )}
          {error === null ? null : (
            <p role="alert" className={dialogStyles.error}>
              {error}
            </p>
          )}
          <div className={dialogStyles.actions}>
            <Button variant="ghost" onClick={close}>
              {m.common_cancel()}
            </Button>
            <Button type="submit" disabled={busy}>
              {m.studio_email_send()}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

const sentAtText = (sentAt: Date) =>
  `${formatDateIn(sentAt, localTimeZone())} ${formatClockIn(sentAt, localTimeZone())}`;

/**
 * The emails sent to those signed up, newest first: when, by whom, the
 * subject and how many. Read once, when the event is opened, and given each
 * email as it is sent. Nothing is shown while there are none.
 */
export function SentEmails(props: {
  readonly id: DocumentId;
  /** The email just sent from the form. */
  readonly latest: SentEmail | null;
}) {
  const { id, latest } = props;
  const [sent, setSent] = useState<ReadonlyArray<SentEmail>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setSent([]);
    setError(null);
    organizerEmails(id).then(
      (rows) => {
        // An email sent while this was on its way is kept, once.
        if (current) {
          setSent((added) => [
            ...added.filter((each) => !rows.some((row) => row.id === each.id)),
            ...rows,
          ]);
        }
      },
      (failure: Error) => {
        if (current) setError(failure.message);
      },
    );
    return () => {
      current = false;
    };
  }, [id]);

  useEffect(() => {
    if (latest === null) return;
    setSent((rows) =>
      rows.some((row) => row.id === latest.id) ? rows : [latest, ...rows],
    );
  }, [latest]);

  if (sent.length === 0 && error === null) return null;
  return (
    <section className={styles.sentEmails} aria-label={m.studio_emails_sent()}>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          {m.studio_emails_sent_count({ count: sent.length })}
        </h3>
      </div>
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <ul className={styles.list}>
        {sent.map((email) => (
          <li key={email.id} className={styles.item}>
            {email.subject}
            <span className={styles.email}>
              {email.sentBy === null
                ? sentAtText(email.sentAt)
                : m.studio_emails_sent_by({
                    when: sentAtText(email.sentAt),
                    name: email.sentBy,
                  })}
            </span>
            <span className={styles.email}>
              {m.studio_emails_sent_recipients({ count: email.recipients })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
