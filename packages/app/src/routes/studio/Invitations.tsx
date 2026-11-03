import {
  type DocumentId,
  describe,
  type Invitation,
  isEmailAddress,
  Problem,
} from "@skjera/documents/api";
import { m } from "@skjera/i18n/messages";
import { Option, Schema } from "effect";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { invitations, invite } from "../../sync/tables.ts";
import styles from "./Attendees.module.css";
import { invitationsHeading, invitedAs } from "./invitations.ts";

const decodeProblem = Schema.decodeUnknownOption(Problem);

/**
 * Who an organizer noted as invited to the event: a record only, nothing is
 * sent. Read once, when the event is opened, and added to as people are noted.
 */
export function Invitations(props: { readonly id: DocumentId }) {
  const { id } = props;
  const [invited, setInvited] = useState<ReadonlyArray<Invitation> | null>(
    null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  /** Why the email was refused: shown by its field. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** Any other failure, to read or to add. */
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const messageId = useId();

  useEffect(() => {
    let current = true;
    setInvited(null);
    setName("");
    setEmail("");
    setRefusal(null);
    setError(null);
    setAdded(null);
    invitations(id).then(
      (rows) => {
        // Someone added while this was on its way is kept, once.
        if (current) {
          setInvited((added) => [
            ...rows,
            ...(added ?? []).filter(
              (person) => !rows.some((row) => row.id === person.id),
            ),
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

  const add = (event: FormEvent) => {
    event.preventDefault();
    setRefusal(null);
    setError(null);
    setAdded(null);
    if (!isEmailAddress(email)) {
      setRefusal(describe({ _tag: "InvitedEmailInvalid" }));
      return;
    }
    setBusy(true);
    invite(id, name.trim() === "" ? { email } : { name, email }).then(
      (person) => {
        setInvited((rows) => [...(rows ?? []), person]);
        setAdded(m.studio_invitation_added({ email: person.email }));
        setName("");
        setEmail("");
        setBusy(false);
      },
      (failure: Error & { readonly problem?: unknown }) => {
        const problem = decodeProblem(failure.problem);
        if (
          Option.isSome(problem) &&
          (problem.value._tag === "InvitedEmailInvalid" ||
            problem.value._tag === "AlreadyInvited")
        ) {
          setRefusal(describe(problem.value));
        } else {
          setError(failure.message);
        }
        setBusy(false);
      },
    );
  };

  return (
    <section className={styles.invitations} aria-label={m.studio_invitations()}>
      <div className={styles.header}>
        <h3 className={styles.heading}>
          {invitationsHeading(invited === null ? null : invited.length)}
        </h3>
      </div>
      <p className={styles.hint}>{m.studio_invitations_hint()}</p>
      <form className={styles.form} onSubmit={add} noValidate>
        <Input
          name="name"
          aria-label={m.studio_invitation_name()}
          placeholder={m.studio_invitation_name()}
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className={styles.field}>
          <Input
            name="email"
            type="email"
            aria-label={m.studio_invitation_email()}
            placeholder={m.studio_invitation_email()}
            aria-invalid={refusal === null ? undefined : true}
            aria-describedby={refusal === null ? undefined : messageId}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {refusal === null ? null : (
            <p id={messageId} className={styles.error}>
              {refusal}
            </p>
          )}
        </div>
        <Button type="submit" disabled={busy}>
          {m.studio_invitation_add()}
        </Button>
      </form>
      {added === null ? null : <p role="status">{added}</p>}
      {error === null ? null : (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {invited === null || invited.length === 0 ? null : (
        <ul className={styles.list}>
          {invited.map((person) => (
            <li key={person.id} className={styles.item}>
              {invitedAs(person)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
